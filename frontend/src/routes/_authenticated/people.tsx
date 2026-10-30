import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Download,
  Mail,
  Phone,
  Search,
  UserRound,
  UsersRound,
  Clock3,
  ArrowUpDown,
  SlidersHorizontal,
  MoreHorizontal,
  Copy,
  Briefcase,
  CalendarDays,
  FileText,
  History,
  ArrowRight,
  ChevronRight,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingRows } from "@/components/data-states";
import { AttendanceBadge, IntentBadge, SoftBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchPeopleForExport, useActivity, useNotes, usePersonBookings } from "@/lib/queries";
import type { PersonRecord } from "@/lib/queries";
import { buildPeopleCsv, downloadCsv, peopleCsvFilename } from "@/lib/export-attendees";
import { toast } from "sonner";
import { formatDateTime, initials } from "@/lib/domain";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import "@/styles/people.css";
import "@/styles/person-drawer.css";

type PeopleTab = "all" | "recent" | "needs";
type PeopleSort = "name-asc" | "name-desc" | "newest" | "oldest";
const hasEmail = (person: PersonRecord) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email?.trim() ?? "");
const hasPhone = (person: PersonRecord) => Boolean(person.phone?.trim());
const hasJob = (person: PersonRecord) => Boolean(person.job_title?.trim());
const needsDetails = (person: PersonRecord) => !hasEmail(person) || !hasPhone(person);
const createdTime = (person: PersonRecord) => Date.parse(person.created_at);

async function copyEmail(email: string) {
  try {
    await navigator.clipboard.writeText(email);
    toast.success("Email copied");
  } catch {
    toast.error("Unable to copy email");
  }
}

export const Route = createFileRoute("/_authenticated/people")({
  head: () => ({
    meta: [
      { title: "People — Event Attendance Hub" },
      {
        name: "description",
        content: "Search registrants by name, email or phone and review every event they booked.",
      },
      { property: "og:title", content: "People — Event Attendance Hub" },
      {
        property: "og:description",
        content: "One profile per person across all of their event registrations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<PersonRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  // Reuse the existing read-only directory/export reader rather than the
  // search hook's 300-row window, so summaries and filters use the same records.
  const people = useQuery({ queryKey: ["people-directory"], queryFn: fetchPeopleForExport });
  const [tab, setTab] = useState<PeopleTab>("all");
  const [sort, setSort] = useState<PeopleSort>("name-asc");
  const [emailFilter, setEmailFilter] = useState("all");
  const [phoneFilter, setPhoneFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [now] = useState(() => Date.now());
  const recent = (person: PersonRecord) =>
    createdTime(person) >= now - 30 * 86400000 && createdTime(person) <= now;
  const records = people.data ?? [];
  const total = records.length;
  const withEmail = records.filter(hasEmail).length;
  const withPhone = records.filter(hasPhone).length;
  const recentlyAdded = records.filter(recent).length;
  const incomplete = records.filter(needsDetails).length;
  const filterCount = [emailFilter, phoneFilter, jobFilter].filter(
    (value) => value !== "all",
  ).length;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (people.data ?? [])
      .filter((person) => {
        if (
          term &&
          ![person.full_name, person.email, person.phone].some((value) =>
            value?.toLowerCase().includes(term),
          )
        )
          return false;
        if (
          tab === "recent" &&
          !(createdTime(person) >= now - 30 * 86400000 && createdTime(person) <= now)
        )
          return false;
        if (tab === "needs" && !needsDetails(person)) return false;
        if (emailFilter !== "all" && hasEmail(person) !== (emailFilter === "with")) return false;
        if (phoneFilter !== "all" && hasPhone(person) !== (phoneFilter === "with")) return false;
        if (jobFilter !== "all" && hasJob(person) !== (jobFilter === "with")) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "name-asc" || sort === "name-desc") {
          const order = (a.full_name ?? "").localeCompare(b.full_name ?? "", "en", {
            sensitivity: "base",
          });
          return order * (sort === "name-desc" ? -1 : 1);
        }
        const left = createdTime(a),
          right = createdTime(b);
        if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
        if (!Number.isFinite(right)) return -1;
        return sort === "newest" ? right - left : left - right;
      });
  }, [people.data, search, tab, sort, emailFilter, phoneFilter, jobFilter, now]);
  const percentage = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  const summaries = [
    {
      label: "Total people",
      count: total,
      Icon: UsersRound,
      tone: "purple",
      detail: total >= 5000 ? "Loaded records (limit reached)" : "Across your people directory",
    },
    {
      label: "With email",
      count: withEmail,
      Icon: Mail,
      tone: "blue",
      detail: `${percentage(withEmail)}% have a valid email address`,
    },
    {
      label: "With phone",
      count: withPhone,
      Icon: Phone,
      tone: "green",
      detail: `${percentage(withPhone)}% have a phone number`,
    },
    {
      label: "Recently added",
      count: recentlyAdded,
      Icon: Clock3,
      tone: "orange",
      detail: "In the last 30 days",
    },
  ];

  async function exportPeople() {
    setExporting(true);
    try {
      const allPeople = await fetchPeopleForExport();
      const csv = buildPeopleCsv(allPeople);
      downloadCsv(peopleCsvFilename(), csv);
      toast.success(
        `Exported ${allPeople.length} person${allPeople.length === 1 ? "" : " record"}`,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="people-view">
      <header className="people-hero">
        <img
          className="people-hero-photo"
          src="/images/people-header.png.png"
          alt=""
          fetchPriority="high"
        />
        <svg
          className="people-hero-ribbons"
          viewBox="0 0 1600 320"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 0H270C500 10 540 210 750 300C540 252 420 54 0 78Z"
            fill="#d4bde9"
            fillOpacity=".4"
          />
          <path
            d="M0 68C300 8 455 110 650 250C450 170 300 46 0 97Z"
            fill="#fffaf7"
            fillOpacity=".68"
          />
          <path
            d="M1600 0H1470C1350 92 1320 193 1160 306C1390 271 1475 186 1600 175Z"
            fill="#d4b9f2"
            fillOpacity=".48"
          />
          <path d="M1600 175C1450 200 1300 260 1150 320H1600Z" fill="#fffdfb" fillOpacity=".9" />
        </svg>
        <p className="people-eyebrow">People</p>
        <PageHeader
          title="People"
          description="Manage your team, attendees and contacts in one place."
          actions={
            <div className="people-header-actions">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 rounded-lg bg-background px-3 text-foreground"
                disabled={exporting}
                onClick={() => void exportPeople()}
              >
                <Download className="size-4" />
                {exporting ? "Exporting…" : "Export people"}
              </Button>
              <div className="people-search">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, email or phone"
                  aria-label="Search people"
                  className="w-full pl-9 sm:w-80"
                />
              </div>
            </div>
          }
        />

        <div className="people-summaries" aria-label="People directory statistics">
          {summaries.map(({ label, count, Icon, tone, detail }) => (
            <section className={`people-summary people-summary-${tone}`} key={label}>
              <span className="people-summary-icon">
                <Icon aria-hidden="true" />
              </span>
              <div>
                <h2>{label}</h2>
                <strong>{people.isLoading || people.error ? "—" : count}</strong>
                <p>
                  {people.isLoading
                    ? "Loading people..."
                    : people.error
                      ? "Data unavailable"
                      : detail}
                </p>
              </div>
              <span className="people-summary-arrow" aria-hidden="true">
                <ChevronRight />
              </span>
              <svg
                className="people-summary-art"
                viewBox="0 0 150 90"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <linearGradient id={`people-summary-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="currentColor" stopOpacity=".55" />
                    <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {tone === "purple" || tone === "orange" ? (
                  [18, 30, 43, 59, 68, 83, 72].map((height, index) => (
                    <rect
                      key={index}
                      x={index * 20 + 5}
                      y={90 - height}
                      width="16"
                      height={height}
                      rx="2"
                      fill={`url(#people-summary-fill-${tone})`}
                    />
                  ))
                ) : (
                  <path
                    d="M5 68C18 75 21 99 36 76S53 43 68 51S84 70 101 51S129 27 145 32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                )}
              </svg>
            </section>
          ))}
        </div>
      </header>
      <div className="people-body">
        <div className="people-toolbar">
          <div className="people-tabs" role="group" aria-label="People filters">
            <button type="button" aria-pressed={tab === "all"} onClick={() => setTab("all")}>
              All people ({people.data ? total : "—"})
            </button>
            <button
              type="button"
              disabled
              title="Staff classification is not available in people records"
              aria-describedby="people-staff-unavailable"
            >
              Staff (—)
            </button>
            <span id="people-staff-unavailable" className="sr-only">
              Staff classification is unavailable; no staff status is inferred from contact details
              or job titles.
            </span>
            <button type="button" aria-pressed={tab === "recent"} onClick={() => setTab("recent")}>
              Recent ({people.data ? recentlyAdded : "—"})
            </button>
            <button
              type="button"
              aria-pressed={tab === "needs"}
              onClick={() => setTab("needs")}
              title="Invalid or missing email, or missing phone number"
            >
              Needs details ({people.data ? incomplete : "—"})
            </button>
          </div>
          <div className="people-sort-filter">
            <Select value={sort} onValueChange={(value) => setSort(value as PeopleSort)}>
              <SelectTrigger aria-label="Sort people">
                <ArrowUpDown aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Name (A–Z)</SelectItem>
                <SelectItem value="name-desc">Name (Z–A)</SelectItem>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="people-filter-button">
                  <SlidersHorizontal aria-hidden="true" />
                  Filter{filterCount ? ` (${filterCount})` : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="people-filter-popover"
                aria-label="Filter people by contact details"
              >
                <h2>Filter people</h2>
                <p>Combine contact and job details with your search and selected tab.</p>
                <label htmlFor="people-email-filter">Email address</label>
                <select
                  id="people-email-filter"
                  value={emailFilter}
                  onChange={(event) => setEmailFilter(event.target.value)}
                >
                  <option value="all">Any email status</option>
                  <option value="with">Valid email available</option>
                  <option value="without">Missing or invalid email</option>
                </select>
                <label htmlFor="people-phone-filter">Phone number</label>
                <select
                  id="people-phone-filter"
                  value={phoneFilter}
                  onChange={(event) => setPhoneFilter(event.target.value)}
                >
                  <option value="all">Any phone status</option>
                  <option value="with">Phone available</option>
                  <option value="without">Missing phone</option>
                </select>
                <label htmlFor="people-job-filter">Job title</label>
                <select
                  id="people-job-filter"
                  value={jobFilter}
                  onChange={(event) => setJobFilter(event.target.value)}
                >
                  <option value="all">Any job title status</option>
                  <option value="with">Job title available</option>
                  <option value="without">Missing job title</option>
                </select>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEmailFilter("all");
                    setPhoneFilter("all");
                    setJobFilter("all");
                  }}
                >
                  Reset detail filters
                </Button>
                <p>Needs details means an invalid or missing email, or a missing phone number.</p>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {total >= 5000 && (
          <p className="people-limit-note">
            Showing the first 5,000 loaded records. Statistics and filters apply to these records;
            the existing reader does not provide a full database count.
          </p>
        )}
        <p className="sr-only" role="status">
          {people.isLoading ? "Loading people" : `${rows.length} people shown`}
        </p>

        {people.error ? (
          <ErrorState message={(people.error as Error).message} onRetry={() => people.refetch()} />
        ) : people.isLoading ? (
          <LoadingRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<UserRound className="size-5" />}
            title={total ? "No people match these filters" : "No people imported yet"}
            description={
              total
                ? "Try a different search, tab or contact filter."
                : "Run a sync in Admin settings to import registrants."
            }
          />
        ) : (
          <div className="people-grid">
            {rows.map((person) => (
              <article key={person.id} className="people-card">
                <div className="people-card-top">
                  <span className="people-avatar" aria-hidden="true">
                    {initials(person.full_name ?? person.email)}
                  </span>
                  <div className="people-identity">
                    <button
                      type="button"
                      onClick={() => setActive(person)}
                      title={person.full_name ?? "Unnamed"}
                    >
                      {person.full_name?.trim() || "Unnamed"}
                    </button>
                    <p title={person.job_title ?? undefined}>
                      {person.job_title?.trim() || "No job title"}
                    </p>
                  </div>
                  <div className="people-card-actions">
                    <Button
                      className="people-open"
                      size="sm"
                      variant="ghost"
                      onClick={() => setActive(person)}
                      aria-label={`Open ${person.full_name ?? "person"}`}
                    >
                      Open <ArrowRight aria-hidden="true" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          className="people-more"
                          aria-label={`More actions for ${person.full_name ?? "person"}`}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setActive(person)}>
                          <UserRound aria-hidden="true" />
                          Open person
                        </DropdownMenuItem>
                        {person.email?.trim() && (
                          <DropdownMenuItem onSelect={() => void copyEmail(person.email!.trim())}>
                            <Copy aria-hidden="true" />
                            Copy email
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="people-contact">
                  <p>
                    <Mail aria-hidden="true" />
                    <span title={person.email ?? undefined}>{person.email?.trim() || "—"}</span>
                  </p>
                  <p>
                    <Phone aria-hidden="true" />
                    <span title={person.phone ?? undefined}>{person.phone?.trim() || "—"}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <PersonDrawer person={active} onClose={() => setActive(null)} />
    </div>
  );
}

function PersonDrawer({ person, onClose }: { person: PersonRecord | null; onClose: () => void }) {
  const bookings = usePersonBookings(person?.id ?? "");
  const activity = useActivity({ personId: person?.id, limit: 30 });
  const notes = useNotes(undefined, person?.id);

  return (
    <Sheet open={Boolean(person)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="person-details-drawer scrollbar-slim">
        {person ? (
          <>
            <SheetHeader className="person-drawer-header">
              <span className="person-drawer-avatar" aria-hidden="true">
                {initials(person.full_name ?? person.email)}
              </span>
              <div className="person-drawer-identity">
                <SheetTitle>{person.full_name ?? "Unnamed person"}</SheetTitle>
                <SheetDescription>{person.email ?? "No email"}</SheetDescription>
              </div>
            </SheetHeader>
            <div className="person-drawer-body">
              <div className="person-drawer-info-grid">
                <div className="person-drawer-info-card">
                  <span className="person-drawer-field-icon">
                    <Mail aria-hidden="true" />
                  </span>
                  <div>
                    <p className="person-drawer-field-label">Email</p>
                    <p>{person.email ?? "No email"}</p>
                  </div>
                </div>
                <div className="person-drawer-info-card">
                  <span className="person-drawer-field-icon">
                    <Phone aria-hidden="true" />
                  </span>
                  <div>
                    <p className="person-drawer-field-label">Phone</p>
                    <p>{person.phone || "No phone number"}</p>
                  </div>
                </div>
                {person.job_title && (
                  <div className="person-drawer-info-card">
                    <span className="person-drawer-field-icon">
                      <Briefcase aria-hidden="true" />
                    </span>
                    <div>
                      <p className="person-drawer-field-label">Job title</p>
                      <p>{person.job_title}</p>
                    </div>
                  </div>
                )}
              </div>
              <section
                className="person-drawer-section person-drawer-registrations"
                aria-label="Person registrations"
              >
                <h3>
                  <CalendarDays aria-hidden="true" /> Registrations
                </h3>
                <div className="person-registration-list">
                  {bookings.isLoading ? (
                    <LoadingRows rows={2} />
                  ) : (bookings.data ?? []).length === 0 ? (
                    <div className="person-drawer-empty">
                      <CalendarDays aria-hidden="true" />
                      <p>No registrations found.</p>
                    </div>
                  ) : (
                    bookings.data!.map((booking) => (
                      <div key={booking.id} className="person-registration-card">
                        <div className="person-registration-heading">
                          <div className="min-w-0">
                            <p className="person-registration-title">
                              {booking.event?.event_name ?? "Event"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(booking.event?.start_at)}
                            </p>
                          </div>
                          {booking.event ? (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to="/events/$eventId"
                                params={{ eventId: booking.event.id }}
                                onClick={onClose}
                              >
                                Open
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                        <div className="person-registration-badges">
                          <IntentBadge value={booking.status.attendance_intent} showDot />
                          <AttendanceBadge value={booking.status.actual_attendance} />
                          {booking.booking_status ? (
                            <SoftBadge tone="neutral">{booking.booking_status}</SoftBadge>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section
                className="person-drawer-section person-drawer-notes"
                aria-label="Person notes"
              >
                <h3>
                  <FileText aria-hidden="true" /> Notes
                </h3>
                <div className="person-note-list">
                  {(notes.data ?? []).length === 0 ? (
                    <div className="person-drawer-empty">
                      <FileText aria-hidden="true" />
                      <p>No notes recorded.</p>
                    </div>
                  ) : (
                    notes.data!.map((note) => (
                      <div key={note.id} className="person-note-card">
                        <p className="text-sm text-foreground">{note.body}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {note.author?.full_name ?? "Staff"} · {formatDateTime(note.created_at)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section
                className="person-drawer-section person-drawer-activity"
                aria-label="Person activity"
              >
                <h3>
                  <History aria-hidden="true" /> Activity
                </h3>
                <ol className="person-drawer-timeline">
                  {(activity.data ?? []).length === 0 ? (
                    <li className="person-drawer-empty">
                      <History aria-hidden="true" />
                      <p>No activity yet.</p>
                    </li>
                  ) : (
                    activity.data!.map((item) => (
                      <li key={item.id} className="person-timeline-item">
                        <span className="person-timeline-icon" aria-hidden="true">
                          {item.action === "note_added" ? (
                            <FileText />
                          ) : item.action.startsWith("callback_") ? (
                            <Phone />
                          ) : (
                            <History />
                          )}
                        </span>
                        <div>
                          <p className="text-sm text-foreground">
                            {item.action.replace(/_/g, " ")}
                            {item.event?.event_name ? ` · ${item.event.event_name}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.actor?.full_name ?? "Staff"} · {formatDateTime(item.created_at)}
                          </p>
                        </div>
                      </li>
                    ))
                  )}
                </ol>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
