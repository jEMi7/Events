import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Search,
  Users,
  CalendarDays,
  MapPin,
  Building2,
  ChevronRight,
  MoreHorizontal,
  Phone,
  Mail,
  ContactRound,
  UserCheck,
  UserX,
  Clock3,
  MessagesSquare,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import "@/styles/event-details.css";
import { MiniStat } from "@/components/kpi-card";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingCards, LoadingRows } from "@/components/data-states";
import { AttendanceBadge, IntentBadge, OriginBadge, SoftBadge } from "@/components/status-badge";
import { QuickActions, refFor } from "@/components/attendee-actions";
import { AttendeeDrawer } from "@/components/attendee-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchContactAttempts, useBookings, useEvent } from "@/lib/queries";
import type { BookingRecord } from "@/lib/queries";
import { useBulkAttendance, useBulkIntent } from "@/lib/mutations";
import { attendeesCsvFilename, buildAttendeesCsv, downloadCsv } from "@/lib/export-attendees";
import { toast } from "sonner";
import { statsFor } from "@/lib/analytics";
import { formatDateTime, formatShort, initials, relativeFromNow } from "@/lib/domain";
import type { AttendanceIntent } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/events/$eventId")({
  head: () => ({
    meta: [
      { title: "Event detail — Event Attendance Hub" },
      {
        name: "description",
        content:
          "Work the attendee list: confirm, decline, schedule call backs and record attendance.",
      },
      { property: "og:title", content: "Event detail — Event Attendance Hub" },
      {
        property: "og:description",
        content: "Attendee-level confirmation and attendance workspace for a single event.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventDetail,
});

type IntentFilter = "all" | AttendanceIntent | "attended" | "absent" | "callbacks";

const FILTERS: { key: IntentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_contacted", label: "Not contacted" },
  { key: "confirmed", label: "Confirmed" },
  { key: "declined", label: "Declined" },
  { key: "maybe", label: "Maybe" },
  { key: "no_answer", label: "No answer" },
  { key: "call_back", label: "Call back" },
  { key: "cancelled", label: "Cancelled" },
  { key: "attended", label: "Attended" },
  { key: "absent", label: "Absent" },
];

const EVENT_INTENT_CLASSES: Record<AttendanceIntent, string> = {
  not_contacted: "bg-lav-100 text-secondary-foreground ring-lav-200",
  confirmed: "bg-success/15 text-success ring-success/30",
  declined: "bg-destructive/15 text-destructive ring-destructive/30",
  maybe: "bg-warning/20 text-warning-foreground ring-warning/35",
  no_answer: "bg-muted text-muted-foreground ring-border",
  call_back: "bg-info/15 text-info ring-info/30",
  cancelled: "bg-destructive/15 text-destructive ring-destructive/30",
};

function matches(booking: BookingRecord, filter: IntentFilter) {
  if (filter === "all") return true;
  if (filter === "attended") return booking.status.actual_attendance === "attended";
  if (filter === "absent") return booking.status.actual_attendance === "absent";
  if (filter === "callbacks") return Boolean(booking.status.callback_at);
  return booking.status.attendance_intent === filter;
}

// Read optional descriptive metadata only when it exists in the saved source payload.
function sourceText(payload: Record<string, unknown> | null, keys: string[]) {
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (
      keys.includes(key.toLowerCase().replace(/[ _-]/g, "")) &&
      typeof value === "string" &&
      value.trim()
    )
      return value.trim();
  }
  return null;
}

function EventAttendeeActions({
  booking,
  onDetails,
}: {
  booking: BookingRecord;
  onDetails: () => void;
}) {
  return (
    <div className="event-attendee-actions">
      {booking.person.phone ? (
        <a
          className="event-contact-action"
          href={`tel:${booking.person.phone}`}
          aria-label="Call attendee"
          title="Call attendee"
        >
          <Phone />
        </a>
      ) : (
        <Button size="icon" variant="outline" disabled aria-label="Call attendee: no phone">
          <Phone />
        </Button>
      )}
      {booking.person.email ? (
        <a
          className="event-contact-action"
          href={`mailto:${booking.person.email}`}
          aria-label="Email attendee"
          title="Email attendee"
        >
          <Mail />
        </a>
      ) : (
        <Button size="icon" variant="outline" disabled aria-label="Email attendee: no email">
          <Mail />
        </Button>
      )}
      <Button
        size="icon"
        variant="outline"
        onClick={onDetails}
        aria-label="Attendee details"
        title="Attendee details"
      >
        <ContactRound />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            aria-label="More attendee actions"
            title="More attendee actions"
          >
            <MoreHorizontal />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="event-details-more"
          align="end"
          aria-label="All attendee actions"
        >
          <h3>Status and attendance</h3>
          <QuickActions booking={booking} variant="buttons" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function EventDetail() {
  const { eventId } = Route.useParams();
  const event = useEvent(eventId);
  const bookings = useBookings(eventId);
  const bulkIntent = useBulkIntent();
  const bulkAttendance = useBulkAttendance();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<IntentFilter>("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<BookingRecord | null>(null);
  const [meetingLinkCopied, setMeetingLinkCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState("attendees");

  const all = bookings.data ?? [];
  const stats = useMemo(() => statsFor(all), [all]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((booking) => matches(booking, filter))
      .filter((booking) => {
        if (!term) return true;
        const person = booking.person;
        return [
          person.full_name,
          person.email,
          person.phone,
          person.job_title,
          booking.source_account,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => (a.person.full_name ?? "").localeCompare(b.person.full_name ?? ""));
  }, [all, filter, search]);

  const counts = useMemo(() => {
    const map = new Map<IntentFilter, number>();
    for (const option of FILTERS) {
      map.set(option.key, all.filter((booking) => matches(booking, option.key)).length);
    }
    return map;
  }, [all]);

  const selectedRefs = rows.filter((booking) => selected[booking.id]).map(refFor);
  const allSelected = rows.length > 0 && rows.every((booking) => selected[booking.id]);
  const busy = bulkIntent.isPending || bulkAttendance.isPending;

  function toggleAll(next: boolean) {
    const map: Record<string, boolean> = { ...selected };
    for (const booking of rows) map[booking.id] = next;
    setSelected(map);
  }

  async function copyMeetingLink(url: string) {
    await navigator.clipboard.writeText(url);
    setMeetingLinkCopied(true);
    window.setTimeout(() => setMeetingLinkCopied(false), 1800);
  }

  async function exportAttendees() {
    if (!event.data) return;
    setExporting(true);
    try {
      let attempts: Record<string, number> = {};
      try {
        attempts = await fetchContactAttempts(eventId);
      } catch {
        attempts = {};
      }
      const csv = buildAttendeesCsv(all, attempts);
      downloadCsv(attendeesCsvFilename(event.data), csv);
      toast.success(`Exported ${all.length} attendee${all.length === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const activeBooking = active ? (all.find((booking) => booking.id === active.id) ?? active) : null;

  if (event.error || bookings.error) {
    return (
      <ErrorState
        message={((event.error ?? bookings.error) as Error).message}
        onRetry={() => {
          event.refetch();
          bookings.refetch();
        }}
      />
    );
  }

  if (event.isLoading) {
    return (
      <div className="space-y-4">
        <LoadingCards count={4} />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (!event.data) {
    return (
      <EmptyState
        title="Event not found"
        description="It may have been removed from the source spreadsheet."
        action={
          <Button asChild variant="outline">
            <Link to="/events">Back to events</Link>
          </Button>
        }
      />
    );
  }

  const record = event.data;

  const metadata = {
    location: sourceText(record.raw_payload, ["location", "venue", "eventlocation"]),
    type: sourceText(record.raw_payload, ["eventtype", "deliverymode"]),
    programme: sourceText(record.raw_payload, ["programme", "program", "department"]),
  };
  let displayTimezone = record.timezone || "Europe/London";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: displayTimezone });
  } catch {
    displayTimezone = "Europe/London";
  }
  const date = record.start_at ? new Date(record.start_at) : null;
  const end = record.end_at ? new Date(record.end_at) : null;
  const validStart = date && !Number.isNaN(date.getTime());
  const validEnd = end && !Number.isNaN(end.getTime());
  const timeFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTimezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const minutes =
    validStart && validEnd && end > date
      ? Math.round((end.getTime() - date.getTime()) / 60000)
      : null;

  return (
    <div className="event-details-view">
      <nav className="event-details-breadcrumb" aria-label="Breadcrumb">
        <Link to="/events">
          <ArrowLeft /> Events
        </Link>
        <ChevronRight />
        <span aria-current="page">Event details</span>
      </nav>
      <section className="event-details-hero">
        <div className="event-details-photo">
          <img
            src="/images/event-details-hero.png"
            alt="Conference presenter and audience in front of the Kent Business College presentation screen"
          />
        </div>
        <div className="event-details-info">
          <div className="event-details-badges">
            <SoftBadge tone={record.status === "live" ? "success" : "neutral"}>
              {record.status ?? "unknown"}
            </SoftBadge>
            <OriginBadge origin={record.data_origin} />
          </div>
          <h1>{record.event_name}</h1>
          {record.description && <p>{record.description}</p>}
          <div className="event-photo-meta">
            <div>
              <CalendarDays />
              <p>
                <strong>
                  {validStart
                    ? new Intl.DateTimeFormat("en-GB", {
                        timeZone: displayTimezone,
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      }).format(date)
                    : "Date not provided"}
                </strong>
                {validStart && (
                  <span>
                    {timeFormat.format(date)}
                    {validEnd ? ` – ${timeFormat.format(end)}` : ""}
                    {minutes
                      ? ` (${minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} min`})`
                      : ""}
                  </span>
                )}
              </p>
            </div>
            <div>
              <MapPin />
              <p>
                <strong>{displayTimezone}</strong>
              </p>
            </div>
            {(metadata.location || metadata.type) && (
              <div>
                <Building2 />
                <p>
                  <strong>{metadata.location || metadata.type}</strong>
                  {metadata.location && metadata.type && <span>{metadata.type}</span>}
                </p>
              </div>
            )}
            {metadata.programme && (
              <div>
                <Building2 />
                <p>
                  <strong>{metadata.programme}</strong>
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="event-details-overview">
          <div className="event-details-meeting-actions">
            {record.meeting_url ? (
              <Button asChild size="sm" className="rounded-lg px-3.5">
                <a href={record.meeting_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Open Zoom
                </a>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0}>
                    <Button type="button" size="sm" className="rounded-lg px-3.5" disabled>
                      <ExternalLink className="size-4" /> Open Zoom
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>No meeting link available</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={record.meeting_url ? -1 : 0}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-lg px-3.5"
                    disabled={!record.meeting_url}
                    onClick={() => {
                      if (record.meeting_url) void copyMeetingLink(record.meeting_url);
                    }}
                  >
                    {meetingLinkCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {meetingLinkCopied ? "Copied" : "Copy Zoom link"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!record.meeting_url ? (
                <TooltipContent>No meeting link available</TooltipContent>
              ) : null}
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" aria-label="More event actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTab("details")}>
                  View event details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void exportAttendees()}
                  disabled={exporting || all.length === 0}
                >
                  Export attendees
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setTab("attendees");
                    setFilter("callbacks");
                  }}
                >
                  Show scheduled call backs
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>
      <section className="event-summary-cards" aria-label="Event registration statistics">
        {[
          { label: "Total Booked", value: stats.booked, Icon: Users, tone: "booked" },
          { label: "Confirmed", value: stats.confirmed, Icon: UserCheck, tone: "confirmed" },
          { label: "Declined", value: stats.declined, Icon: UserX, tone: "declined" },
          { label: "Pending", value: stats.pending, Icon: Clock3, tone: "pending" },
        ].map(({ label, value, Icon, tone }) => (
          <div className="event-summary-card" data-tone={tone} key={tone}>
            <span className="event-summary-icon">
              <Icon />
            </span>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
            <div className="event-summary-bars" aria-hidden="true">
              {[20, 34, 49, 65, 82, 100, 85].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        ))}
      </section>
      <Tabs value={tab} onValueChange={setTab} className="event-details-tabs">
        <TabsList aria-label="Event sections">
          <TabsTrigger value="attendees">
            <Users /> Attendees ({all.length})
          </TabsTrigger>
          <TabsTrigger value="details">
            <CalendarDays /> Event details
          </TabsTrigger>
          <span title="Email campaigns and reminders are not implemented in the existing application.">
            <TabsTrigger value="emails" disabled>
              <Mail /> Emails &amp; Reminders
            </TabsTrigger>
          </span>
          <span title="Event-wide activity is not available. Open an attendee to view their saved history.">
            <TabsTrigger value="activity" disabled>
              <MessagesSquare /> Activity log
            </TabsTrigger>
          </span>
        </TabsList>
        <TabsContent value="details" className="event-details-panel">
          <h2>Event details</h2>
          <dl className="event-details-fields">
            <div>
              <dt>Starts</dt>
              <dd>{formatDateTime(record.start_at)}</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{formatDateTime(record.end_at)}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{record.timezone || "Not provided"}</dd>
            </div>
            {metadata.location && (
              <div>
                <dt>Location</dt>
                <dd>{metadata.location}</dd>
              </div>
            )}
            {metadata.type && (
              <div>
                <dt>Event type</dt>
                <dd>{metadata.type}</dd>
              </div>
            )}
            {(metadata.location || metadata.type) && (
              <div>
                <Building2 />
                <p>
                  <strong>{metadata.location || metadata.type}</strong>
                  {metadata.location && metadata.type && <span>{metadata.type}</span>}
                </p>
              </div>
            )}
            {metadata.programme && (
              <div>
                <dt>Programme / department</dt>
                <dd>{metadata.programme}</dd>
              </div>
            )}
            <div>
              <dt>Starts relative to now</dt>
              <dd>{relativeFromNow(record.start_at)}</dd>
            </div>
          </dl>
          {record.description && <p className="event-details-description">{record.description}</p>}
          <div className="event-additional-stats">
            <MiniStat label="Call backs" value={stats.callBacks} />
            <MiniStat label="Attended" value={stats.attended} />
            <MiniStat label="Absent" value={stats.absent} />
          </div>
          <p className="event-details-help">
            Open an attendee to view their saved notes, call backs and activity history. Email
            campaigns and event-wide activity tabs are not available in the current application.
          </p>
        </TabsContent>
        <TabsContent value="attendees" className="event-attendees-panel">
          <PageHeader
            title={`Attendees (${all.length})`}
            description="People who registered for this event."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-lg bg-background px-3 text-foreground"
                  disabled={exporting || all.length === 0}
                  onClick={() => void exportAttendees()}
                >
                  <Download className="size-4" />
                  {exporting ? "Exporting…" : "Export attendees"}
                </Button>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, email or phone..."
                    aria-label="Search attendees"
                    className="w-full pl-9 sm:w-72"
                  />
                </div>
              </div>
            }
          />

          <div className="event-attendee-filters">
            <FilterChips
              options={FILTERS.map((option) => ({ ...option, count: counts.get(option.key) ?? 0 }))}
              value={filter}
              onChange={setFilter}
              label="Filter attendees"
            />
          </div>

          {selectedRefs.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-lav-200 bg-lav-50 px-4 py-3">
              <span className="text-sm font-medium text-foreground">
                {selectedRefs.length} selected
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => bulkIntent.mutate({ refs: selectedRefs, intent: "confirmed" })}
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => bulkIntent.mutate({ refs: selectedRefs, intent: "no_answer" })}
                >
                  No answer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    bulkAttendance.mutate({ refs: selectedRefs, attendance: "attended" })
                  }
                >
                  Mark attended
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    bulkAttendance.mutate({ refs: selectedRefs, attendance: "absent" })
                  }
                >
                  Mark absent
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          {bookings.isLoading ? (
            <LoadingRows rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title={
                all.length === 0
                  ? "No registrations imported yet"
                  : "No attendees match these filters"
              }
              description={
                all.length === 0
                  ? "Run a sync in Admin settings to import registrations for this event."
                  : "Clear the search or choose a different status filter."
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div
                className="event-attendee-table"
                role="region"
                aria-label="Event attendees"
                tabIndex={0}
              >
                <div
                  className="event-attendee-table-inner text-sm"
                  role="table"
                  aria-label="Attendee records"
                >
                  <div
                    role="row"
                    className="table-grid border-b border-border bg-muted/50 py-3 text-left"
                  >
                    <div role="columnheader" className="col-start-1">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(value) => toggleAll(Boolean(value))}
                        aria-label="Select all attendees"
                      />
                    </div>
                    <div role="columnheader" className="col-start-2">
                      #
                    </div>
                    {[
                      { label: "Attendee", colClass: "col-start-3" },
                      { label: "Contact", colClass: "col-start-4" },
                      { label: "Source", colClass: "col-start-5" },
                      { label: "Intent", colClass: "col-start-6" },
                      { label: "Last contacted", colClass: "col-start-7" },
                      { label: "Call back", colClass: "col-start-8" },
                      { label: "Attendance", colClass: "col-start-9" },
                      { label: "Actions", colClass: "col-start-10", align: "text-center" },
                    ].map((column) => (
                      <div
                        key={column.label}
                        role="columnheader"
                        className={`whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground ${column.align ?? ""} ${column.colClass}`}
                      >
                        {column.label}
                      </div>
                    ))}
                  </div>
                  <div>
                    {rows.map((booking, index) => (
                      <div
                        key={booking.id}
                        role="row"
                        className="table-grid h-[72px] py-3 transition-colors hover:bg-lav-50/60 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
                      >
                        <div role="cell" className="col-start-1">
                          <Checkbox
                            checked={Boolean(selected[booking.id])}
                            onCheckedChange={(value) =>
                              setSelected((prev) => ({ ...prev, [booking.id]: Boolean(value) }))
                            }
                            aria-label={`Select ${booking.person.full_name ?? "attendee"}`}
                          />
                        </div>
                        <div role="cell" className="col-start-2 event-row-number">
                          {index + 1}
                        </div>
                        <div role="cell" className="col-start-3">
                          <button
                            type="button"
                            onClick={() => setActive(booking)}
                            className="focus-ring flex max-w-full items-center gap-2.5 text-left"
                          >
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lav-100 text-xs font-semibold text-secondary-foreground ring-1 ring-lav-200">
                              {initials(booking.person.full_name ?? booking.person.email)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground hover:text-primary">
                                {booking.person.full_name ?? "Unnamed attendee"}
                              </span>
                              {booking.person.job_title ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {booking.person.job_title}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </div>
                        <div role="cell" className="col-start-4 text-xs text-muted-foreground">
                          <span className="event-contact-line">
                            <Mail aria-hidden="true" />
                            <span className="truncate">{booking.person.email ?? "No email"}</span>
                          </span>
                          <span className="event-contact-line">
                            <Phone aria-hidden="true" />
                            <span className="truncate">{booking.person.phone ?? "No phone"}</span>
                          </span>
                        </div>
                        <div role="cell" className="col-start-5">
                          <SoftBadge tone="neutral" className="max-w-full">
                            <span className="truncate">
                              {booking.source_account ?? booking.booking_status ?? "—"}
                            </span>
                          </SoftBadge>
                        </div>
                        <div role="cell" className="col-start-6">
                          <IntentBadge
                            value={booking.status.attendance_intent}
                            showDot
                            className={EVENT_INTENT_CLASSES[booking.status.attendance_intent]}
                          />
                        </div>
                        <div
                          role="cell"
                          className="col-start-7 flex w-full min-w-0 items-center justify-start whitespace-nowrap text-xs text-muted-foreground"
                        >
                          <span>
                            {booking.status.last_contacted_at
                              ? formatShort(booking.status.last_contacted_at)
                              : "—"}
                          </span>
                        </div>
                        <div
                          role="cell"
                          className="col-start-8 flex w-full min-w-0 items-center justify-start whitespace-nowrap text-xs text-muted-foreground"
                        >
                          <span>
                            {booking.status.callback_at
                              ? formatShort(booking.status.callback_at)
                              : "—"}
                          </span>
                        </div>
                        <div role="cell" className="col-start-9">
                          <AttendanceBadge value={booking.status.actual_attendance} />
                        </div>
                        <div role="cell" className="col-start-10 flex justify-end">
                          <EventAttendeeActions
                            booking={booking}
                            onDetails={() => setActive(booking)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <AttendeeDrawer
        booking={activeBooking}
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      />
    </div>
  );
}
