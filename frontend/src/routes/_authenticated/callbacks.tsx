import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  PhoneCall,
  RotateCcw,
  CalendarDays,
  Clock3,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Bell,
  ArrowRight,
  MoreHorizontal,
  Eye,
  ArrowUpDown,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingRows } from "@/components/data-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallbacks } from "@/lib/queries";
import type { CallbackRecord } from "@/lib/queries";
import { useCompleteCallback, useRescheduleCallback } from "@/lib/mutations";
import { formatDateTime, formatShort, formatDay, relativeFromNow, initials } from "@/lib/domain";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import "@/styles/callbacks.css";

export const Route = createFileRoute("/_authenticated/callbacks")({
  head: () => ({
    meta: [
      { title: "Call backs — Event Attendance Hub" },
      {
        name: "description",
        content: "Work the call back queue: overdue, due today, upcoming and completed calls.",
      },
      { property: "og:title", content: "Call backs — Event Attendance Hub" },
      {
        property: "og:description",
        content: "A prioritised call back queue with owners, due times and one-click completion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CallbacksPage,
});

type Segment = "overdue" | "today" | "upcoming" | "completed";

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
];

function segmentOf(task: CallbackRecord): Segment {
  if (task.status !== "open") return "completed";
  const due = new Date(task.due_at).getTime();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (due < Date.now()) return "overdue";
  if (due <= endOfToday.getTime()) return "today";
  return "upcoming";
}

function refOf(task: CallbackRecord) {
  return {
    bookingId: task.booking_id,
    eventId: task.booking?.event_id ?? "",
    personId: task.booking?.person_id ?? "",
  };
}

function dialLink(task: CallbackRecord) {
  const phone = task.booking?.person?.phone?.replace(/[^\d+]/g, "") ?? "";
  return /^\+?\d{3,}$/.test(phone) ? `tel:${phone}` : null;
}
function CallbackStatus({ task }: { task: CallbackRecord }) {
  const status = segmentOf(task);
  return (
    <span
      className={`callback-status callback-status-${status}`}
      title={
        status === "completed"
          ? `Completed ${formatShort(task.completed_at)}`
          : formatDateTime(task.due_at)
      }
    >
      {SEGMENTS.find((item) => item.key === status)!.label}
    </span>
  );
}
function CallAction({ task, primary = false }: { task: CallbackRecord; primary?: boolean }) {
  const href = dialLink(task);
  return href ? (
    <Button
      asChild
      size="sm"
      variant={primary ? "default" : "outline"}
      className={primary ? "callback-call-primary" : "callback-call"}
    >
      <a href={href} aria-label={`Call ${task.booking?.person?.full_name ?? "attendee"}`}>
        <PhoneCall aria-hidden="true" />
        Call
      </a>
    </Button>
  ) : (
    <Button size="sm" variant="outline" disabled title="No usable phone number on this attendee">
      <PhoneCall aria-hidden="true" />
      No phone
    </Button>
  );
}

function CallbacksPage() {
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [rescheduling, setRescheduling] = useState<CallbackRecord | null>(null);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState("priority");
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (selected.size === 0) setSelectedOnly(false);
  }, [selected.size]);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const callbacks = useCallbacks();
  const complete = useCompleteCallback();
  const grouped = useMemo(() => {
    const map: Record<Segment, CallbackRecord[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      completed: [],
    };
    for (const task of callbacks.data ?? []) map[segmentOf(task)].push(task);
    return map;
  }, [callbacks.data, clock]);
  const matching = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (callbacks.data ?? []).filter((task) => {
      if (
        term &&
        ![
          task.booking?.person?.full_name,
          task.booking?.event?.event_name,
          task.owner?.full_name,
        ].some((value) => value?.toLowerCase().includes(term))
      )
        return false;
      if (
        owner === "unassigned" ? Boolean(task.owner_id) : owner !== "all" && task.owner_id !== owner
      )
        return false;
      return !phoneOnly || Boolean(dialLink(task));
    });
  }, [callbacks.data, search, owner, phoneOnly]);
  const attention = matching
    .filter((task) => task.status === "open" && ["overdue", "today"].includes(segmentOf(task)))
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const rows = matching
    .filter(
      (task) =>
        (segment === "all" || segmentOf(task) === segment) &&
        (!attentionOnly || attention.some((item) => item.id === task.id)) &&
        (!selectedOnly || selected.has(task.id)),
    )
    .sort((a, b) => {
      if (sort === "priority") {
        const difference =
          SEGMENTS.findIndex((item) => item.key === segmentOf(a)) -
          SEGMENTS.findIndex((item) => item.key === segmentOf(b));
        if (difference) return difference;
      }
      if (sort === "name")
        return (a.booking?.person?.full_name ?? "").localeCompare(
          b.booking?.person?.full_name ?? "",
        );
      if (sort === "owner")
        return (a.owner?.full_name ?? "").localeCompare(b.owner?.full_name ?? "");
      return (Date.parse(a.due_at) - Date.parse(b.due_at)) * (sort === "due-desc" ? -1 : 1);
    });
  const owners = Array.from(
    new Map(
      (callbacks.data ?? [])
        .filter((task) => task.owner_id)
        .map((task) => [task.owner_id!, task.owner?.full_name ?? "Assigned staff"]),
    ),
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const summaries = [
    { key: "overdue" as const, Icon: PhoneCall, detail: "Needs immediate attention" },
    { key: "today" as const, Icon: CalendarDays, detail: "Scheduled for today" },
    { key: "upcoming" as const, Icon: Clock3, detail: "Scheduled for later" },
    { key: "completed" as const, Icon: Check, detail: "All completed calls" },
  ];
  const chooseSegment = (value: Segment | "all") => {
    setSegment(value);
    setAttentionOnly(false);
  };
  const toggleSelection = (id: string, checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const selectedVisible = rows.filter((task) => selected.has(task.id)).length;
  const options = [
    { key: "all" as const, label: `All call backs (${callbacks.data?.length ?? 0})` },
    ...SEGMENTS.map((item) => ({ ...item, label: `${item.label} (${grouped[item.key].length})` })),
  ];
  const actions = (task: CallbackRecord) => (
    <div className="callback-actions">
      {task.status === "open" ? (
        <>
          <CallAction task={task} />
          <Button size="sm" variant="outline" onClick={() => setRescheduling(task)}>
            <CalendarClock aria-hidden="true" />
            Reschedule
          </Button>
        </>
      ) : task.booking?.event ? (
        <Button size="sm" variant="outline" asChild>
          <Link to="/events/$eventId" params={{ eventId: task.booking.event.id }}>
            <Eye aria-hidden="true" />
            Open
          </Link>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            aria-label={`Actions for ${task.booking?.person?.full_name ?? "attendee"}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {task.booking?.event && (
            <DropdownMenuItem asChild>
              <Link to="/events/$eventId" params={{ eventId: task.booking.event.id }}>
                Open event
              </Link>
            </DropdownMenuItem>
          )}
          {task.status === "open" ? (
            <>
              <DropdownMenuItem
                disabled={complete.isPending}
                onSelect={() =>
                  complete.mutate({ id: task.id, ref: refOf(task), intent: "confirmed" })
                }
              >
                <Check aria-hidden="true" />
                Completed &amp; confirmed
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={complete.isPending}
                onSelect={() => complete.mutate({ id: task.id, ref: refOf(task) })}
              >
                Mark done
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => setRescheduling(task)}>
              <RotateCcw aria-hidden="true" />
              Schedule again
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  return (
    <div className="callbacks-view">
      <header className="callbacks-hero">
        <img
          className="callbacks-hero-photo"
          src="/images/callbacks-header.png"
          alt=""
          fetchPriority="high"
        />
        <svg
          className="callbacks-hero-waves"
          viewBox="0 0 1600 300"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 75C230-90 405-20 660 140S830 300 1050 300C795 215 575-25 300 0S68 30 0 75Z"
            fill="#d9c6e9"
            fillOpacity=".52"
          />
          <path
            d="M0 45C210-60 410 5 680 165S865 300 1050 300C805 245 590 50 330 20S65 18 0 45Z"
            fill="#fffaf3"
            fillOpacity=".85"
          />
          <path d="M1600 0H1450C1430 90 1370 190 1270 300H1600Z" fill="#fffaf3" fillOpacity=".5" />
        </svg>
        <div className="callbacks-stay-connected" aria-hidden="true">
          <span>Stay</span>
          <span>Connected</span>
          <i />
        </div>
        <p className="callbacks-eyebrow">
          Call backs <span />
        </p>
        <PageHeader
          title="Call backs"
          description="Track scheduled follow-up calls with attendees, events and owners."
        />
        <div className="callback-summaries" aria-label="Callback statistics">
          {summaries.map(({ key, Icon, detail }) => (
            <button
              className={`callback-summary callback-summary-${key}`}
              type="button"
              key={key}
              aria-pressed={segment === key}
              onClick={() => chooseSegment(key)}
            >
              <span className="callback-summary-icon">
                <Icon aria-hidden="true" />
              </span>
              <span>
                <span className="callback-summary-label">
                  {SEGMENTS.find((item) => item.key === key)!.label}
                </span>
                <strong>
                  {callbacks.isLoading || callbacks.error ? "—" : grouped[key].length}
                </strong>
                <small>{detail}</small>
              </span>
              <ChevronRight className="callback-summary-arrow" aria-hidden="true" />
              <svg
                className="callback-summary-flourish"
                viewBox="0 0 120 64"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M2 59C15 59 17 17 28 27S40 61 51 45S66 59 78 46S94 24 118 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
              </svg>
            </button>
          ))}
        </div>
      </header>
      <div className="callbacks-body">
        <div className="callback-toolbar">
          <FilterChips
            options={options}
            value={segment}
            onChange={chooseSegment}
            label="Call back segment"
          />
          <div className="callback-search-sort">
            <div className="callback-search">
              <Search aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, event or owner..."
                aria-label="Search callbacks"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <SlidersHorizontal aria-hidden="true" />
                  Filter &amp; sort
                  <ChevronRight aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="callback-filter-popover">
                <h2>Filter &amp; sort</h2>
                <Label htmlFor="callback-sort">Sort callbacks</Label>
                <select
                  id="callback-sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="priority">Priority (open first)</option>
                  <option value="due-asc">Soonest first</option>
                  <option value="due-desc">Latest first</option>
                  <option value="name">Attendee name</option>
                  <option value="owner">Owner name</option>
                </select>
                <Label htmlFor="callback-owner">Assigned owner</Label>
                <select
                  id="callback-owner"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                >
                  <option value="all">All owners</option>
                  <option value="unassigned">Unassigned</option>
                  {owners.map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <label className="callback-phone-filter">
                  <input
                    type="checkbox"
                    checked={phoneOnly}
                    onChange={(event) => setPhoneOnly(event.target.checked)}
                  />
                  Only attendees with a usable phone
                </label>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOwner("all");
                    setPhoneOnly(false);
                    setSort("priority");
                  }}
                >
                  Reset filter &amp; sort
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {callbacks.error ? (
          <ErrorState
            message={(callbacks.error as Error).message}
            onRetry={() => callbacks.refetch()}
          />
        ) : callbacks.isLoading ? (
          <LoadingRows rows={6} />
        ) : (
          <>
            <section className="callback-attention" aria-labelledby="callback-attention-heading">
              <CallbackFoliage className="callback-foliage-left" />
              <CallbackFoliage className="callback-foliage-right" />
              <div className="callback-attention-heading">
                <span>
                  <Bell aria-hidden="true" />
                </span>
                <div>
                  <h2 id="callback-attention-heading">Needs attention today</h2>
                  <p>These call backs need your attention as they are overdue or due today.</p>
                </div>
                {attention.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSegment("all");
                      setAttentionOnly(true);
                      document
                        .getElementById("callback-results")
                        ?.scrollIntoView({ block: "start", behavior: "smooth" });
                    }}
                  >
                    View all {attention.length}
                    <ArrowRight aria-hidden="true" />
                  </button>
                )}
              </div>
              {attention.length === 0 ? (
                <div className="callback-attention-empty">
                  <span className="callback-attention-phone" aria-hidden="true">
                    <PhoneCall />
                    <Bell />
                  </span>
                  <p>Nothing needs attention right now.</p>
                </div>
              ) : (
                <div className="callback-priorities">
                  {attention.slice(0, 3).map((task) => (
                    <article className="callback-priority" key={task.id}>
                      <span className={`callback-avatar callback-avatar-${segmentOf(task)}`}>
                        {initials(task.booking?.person?.full_name)}
                      </span>
                      <div className="callback-priority-content">
                        <div className="callback-priority-title">
                          <h3 title={task.booking?.person?.full_name ?? undefined}>
                            {task.booking?.person?.full_name ?? "Attendee"}
                          </h3>
                          <CallbackStatus task={task} />
                        </div>
                        <p
                          className="callback-priority-event"
                          title={task.booking?.event?.event_name ?? undefined}
                        >
                          <CalendarDays aria-hidden="true" />
                          {task.booking?.event?.event_name ?? "Event"}
                        </p>
                        <div className="callback-priority-bottom">
                          <p>
                            <CalendarDays aria-hidden="true" />
                            {formatShort(task.due_at)}
                            <span
                              className={
                                segmentOf(task) === "overdue" ? "callback-overdue-time" : ""
                              }
                            >
                              <Clock3 aria-hidden="true" />
                              {segmentOf(task) === "overdue"
                                ? relativeFromNow(task.due_at).replace(/ ago$/, " overdue")
                                : relativeFromNow(task.due_at)}
                            </span>
                          </p>
                          <CallAction task={task} primary />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <div id="callback-results" className="callback-results">
              {(selected.size > 0 || attentionOnly) && (
                <div className="callback-selection-bar">
                  {selected.size > 0 && (
                    <>
                      <span>{selected.size} selected</span>
                      <button type="button" onClick={() => setSelectedOnly((value) => !value)}>
                        {selectedOnly ? "Show matching calls" : "Show selected only"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(new Set());
                          setSelectedOnly(false);
                        }}
                      >
                        Clear selection
                      </button>
                    </>
                  )}
                  {attentionOnly && (
                    <button type="button" onClick={() => setAttentionOnly(false)}>
                      Clear attention filter
                    </button>
                  )}
                </div>
              )}
              {rows.length === 0 ? (
                <div className="callback-empty-panel">
                  <CallbackFoliage className="callback-foliage-left" />
                  <CallbackFoliage className="callback-foliage-right" />
                  <EmptyState
                    icon={<PhoneCall className="size-5" />}
                    title={
                      callbacks.data?.length
                        ? "No call backs match these filters"
                        : "No call backs scheduled yet"
                    }
                    description={
                      callbacks.data?.length
                        ? "Try another status, search or owner filter."
                        : "Schedule a call back from any attendee row to add it here."
                    }
                  />
                </div>
              ) : (
                <div
                  className="callback-table-scroll"
                  role="region"
                  aria-label="Callback records"
                  tabIndex={0}
                >
                  <table className="callback-table">
                    <thead>
                      <tr>
                        <th>
                          <Checkbox
                            aria-label="Select all visible callbacks"
                            checked={
                              rows.length > 0 && selectedVisible === rows.length
                                ? true
                                : selectedVisible > 0
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(value) =>
                              setSelected((previous) => {
                                const next = new Set(previous);
                                rows.forEach((task) =>
                                  value ? next.add(task.id) : next.delete(task.id),
                                );
                                return next;
                              })
                            }
                          />
                        </th>
                        <th>
                          <button onClick={() => setSort("name")}>
                            Attendee
                            <ArrowUpDown aria-hidden="true" />
                          </button>
                        </th>
                        <th>Event</th>
                        <th>
                          <button onClick={() => setSort("owner")}>
                            Owner
                            <ArrowUpDown aria-hidden="true" />
                          </button>
                        </th>
                        <th>
                          <button
                            onClick={() =>
                              setSort((value) => (value === "due-asc" ? "due-desc" : "due-asc"))
                            }
                          >
                            Scheduled for
                            <ArrowUpDown aria-hidden="true" />
                          </button>
                        </th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((task) => (
                        <tr key={task.id} data-selected={selected.has(task.id) || undefined}>
                          <td>
                            <Checkbox
                              aria-label={`Select ${task.booking?.person?.full_name ?? "attendee"}, ${formatShort(task.due_at)}`}
                              checked={selected.has(task.id)}
                              onCheckedChange={(value) => toggleSelection(task.id, Boolean(value))}
                            />
                          </td>
                          <td>
                            <div className="callback-person">
                              <span
                                className={`callback-avatar callback-avatar-${segmentOf(task)}`}
                              >
                                {initials(task.booking?.person?.full_name)}
                              </span>
                              <div>
                                <strong title={task.booking?.person?.full_name ?? undefined}>
                                  {task.booking?.person?.full_name ?? "Attendee"}
                                </strong>
                                <small title={task.booking?.person?.email ?? undefined}>
                                  {task.booking?.person?.email ?? "No email"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="callback-event-name">
                              {task.booking?.event?.event_name ?? "Event"}
                            </span>
                            {task.note && (
                              <p className="callback-note" title={task.note}>
                                {task.note}
                              </p>
                            )}
                          </td>
                          <td>
                            <div className="callback-owner">
                              <span className="callback-avatar">
                                {initials(task.owner?.full_name)}
                              </span>
                              <span>{task.owner?.full_name ?? "Unassigned"}</span>
                            </div>
                          </td>
                          <td>
                            <div className="callback-scheduled">
                              <span>
                                <CalendarDays aria-hidden="true" />
                                {formatDay(task.due_at)}
                              </span>
                              <span>
                                <Clock3 aria-hidden="true" />
                                {formatDateTime(task.due_at).match(/\d{2}:\d{2}$/)?.[0] ?? "—"}
                              </span>
                            </div>
                          </td>
                          <td>
                            <CallbackStatus task={task} />
                          </td>
                          <td>{actions(task)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <RescheduleDialog task={rescheduling} onClose={() => setRescheduling(null)} />
    </div>
  );
}

function CallbackFoliage({ className }: { className: string }) {
  return (
    <svg
      className={`callback-foliage ${className}`}
      viewBox="0 0 150 200"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M22 196C57 151 70 91 101 12M39 170C69 168 102 155 133 133"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      {[0, 1, 2, 3, 4].map((leaf) => (
        <g key={leaf} transform={`translate(${48 + leaf * 12}, ${153 - leaf * 29})`}>
          <path d="M0 0C-28-3-35-23-32-35C-12-30-3-16 0 0Z" />
          <path d="M0 0C26-3 34-20 32-33C11-29 3-14 0 0Z" />
        </g>
      ))}
      <path d="M76 159C75 141 89 126 105 122C108 138 94 154 76 159ZM106 148C115 131 133 126 147 130C139 147 123 151 106 148Z" />
    </svg>
  );
}

function defaultDueAt() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

function RescheduleDialog({ task, onClose }: { task: CallbackRecord | null; onClose: () => void }) {
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const reschedule = useRescheduleCallback();

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule call back</DialogTitle>
          <DialogDescription>
            {task?.booking?.person?.full_name ?? "This attendee"} will move to the new slot.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-due">New date and time</Label>
          <Input
            id="reschedule-due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reschedule.isPending || !task}
            onClick={() =>
              task &&
              reschedule.mutate({ id: task.id, ref: refOf(task), dueAt }, { onSuccess: onClose })
            }
          >
            {reschedule.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
