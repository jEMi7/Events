import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpDown,
  CalendarDays,
  ExternalLink,
  Search,
  UsersRound,
  Check,
  Clock3,
  ChevronRight,
} from "lucide-react";

import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingRows } from "@/components/data-states";
import { SoftBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookings, useEvents } from "@/lib/queries";
import {
  RANGE_OPTIONS,
  filterEventsByRange,
  groupByEvent,
  sortByStart,
  statsFor,
} from "@/lib/analytics";
import type { RangeKey } from "@/lib/analytics";
import "@/styles/events.css";
import { formatDateTime, relativeFromNow } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/events/")({
  head: () => ({
    meta: [
      { title: "Events — Event Attendance Hub" },
      {
        name: "description",
        content:
          "Search and filter every imported event with live booking and confirmation counts.",
      },
      { property: "og:title", content: "Events — Event Attendance Hub" },
      {
        property: "og:description",
        content: "Live event list with booking, confirmation and pending counts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventsPage,
});

type SortKey = "start-asc" | "start-desc" | "booked-desc" | "confirmed-desc" | "name-asc";

function EventStart({ start, end }: { start: string | null; end: string | null }) {
  const formatted = formatDateTime(start);
  const parts = formatted.match(/^(.*), (\d{2}:\d{2})$/);
  const endTime = end ? formatDateTime(end).match(/(\d{2}:\d{2})$/)?.[1] : null;
  return (
    <div className="events-start">
      <CalendarDays aria-hidden="true" />
      <div>
        <span className="block">{parts?.[1] ?? formatted}</span>
        {parts && (
          <span className="block">
            {parts[2]}
            {endTime ? ` \u2013 ${endTime}` : ""}
          </span>
        )}
        <span className="text-xs">{relativeFromNow(start)}</span>
      </div>
    </div>
  );
}

function EventsPage() {
  const [range, setRange] = useState<RangeKey>("upcoming");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("start-asc");
  const events = useEvents();
  const bookings = useBookings();

  const rows = useMemo(() => {
    const byEvent = groupByEvent(bookings.data ?? []);
    const term = search.trim().toLowerCase();
    let list = filterEventsByRange(events.data ?? [], range).map((event) => ({
      event,
      stats: statsFor(byEvent.get(event.id) ?? []),
    }));

    if (term) {
      list = list.filter(
        (row) =>
          row.event.event_name.toLowerCase().includes(term) ||
          (row.event.description ?? "").toLowerCase().includes(term) ||
          (row.event.source_event_id ?? "").toLowerCase().includes(term),
      );
    }

    switch (sort) {
      case "start-desc":
        return sortByStart(
          list.map((r) => r.event),
          "desc",
        ).map((event) => list.find((r) => r.event.id === event.id)!);
      case "booked-desc":
        return [...list].sort((a, b) => b.stats.booked - a.stats.booked);
      case "confirmed-desc":
        return [...list].sort((a, b) => b.stats.confirmed - a.stats.confirmed);
      case "name-asc":
        return [...list].sort((a, b) => a.event.event_name.localeCompare(b.event.event_name));
      default:
        return sortByStart(
          list.map((r) => r.event),
          "asc",
        ).map((event) => list.find((r) => r.event.id === event.id)!);
    }
  }, [events.data, bookings.data, range, search, sort]);

  const loading = events.isLoading || bookings.isLoading;
  const error = events.error ?? bookings.error;

  const totals = rows.reduce(
    (total, row) => ({
      booked: total.booked + row.stats.booked,
      confirmed: total.confirmed + row.stats.confirmed,
      pending: total.pending + row.stats.pending,
    }),
    { booked: 0, confirmed: 0, pending: 0 },
  );
  const summaries = [
    {
      label: "Total Events",
      value: rows.length,
      Icon: CalendarDays,
      tone: "purple",
      detail: "Current selection",
    },
    {
      label: "Total Registrations",
      value: totals.booked,
      Icon: UsersRound,
      tone: "blue",
      detail: "Event bookings",
    },
    {
      label: "Confirmed",
      value: totals.confirmed,
      Icon: Check,
      tone: "green",
      detail: totals.booked
        ? `${Math.round((totals.confirmed / totals.booked) * 100)}% confirmed`
        : "No registrations in this view",
    },
    {
      label: "Pending",
      value: totals.pending,
      Icon: Clock3,
      tone: "orange",
      detail: totals.booked
        ? `${Math.round((totals.pending / totals.booked) * 100)}% pending`
        : "No registrations in this view",
    },
  ];

  return (
    <div className="events-view">
      <header className="events-hero">
        <img
          className="events-hero-photo"
          src="/images/events-conference-hero.png"
          alt=""
          fetchPriority="high"
        />
        <svg
          className="events-hero-ribbons"
          viewBox="0 0 1400 300"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 72C180-70 350-28 580 110S790 290 1060 300C740 230 560 66 350 25S110 18 0 72Z"
            fill="#d9c9ec"
            fillOpacity=".5"
          />
          <path
            d="M0 48C220-65 395 12 615 135S820 297 1060 300C780 260 565 100 360 38S100 12 0 48Z"
            fill="#fffaf3"
            fillOpacity=".78"
          />
        </svg>
        <nav className="events-breadcrumb" aria-label="Breadcrumb">
          <Link to="/dashboard">Dashboard</Link>
          <ChevronRight aria-hidden="true" />
          <span aria-current="page">Events</span>
        </nav>
        <p className="events-eyebrow">Event Registrations Hub <span /></p>
        <h1>Events</h1>
        <p className="events-hero-intro">Manage and track all event registrations in one place.</p>
        <div className="events-summaries" aria-label="Event statistics for current filters">
          {summaries.map(({ label, value, Icon, tone, detail }) => (
            <section className={`events-summary events-summary-${tone}`} key={label}>
              <span className="events-summary-icon">
                <Icon aria-hidden="true" />
              </span>
              <div>
                <h2>{label}</h2>
                <strong>{loading || error ? "—" : value}</strong>
                <p>
                  {loading ? "Loading event data..." : error ? "Event data unavailable" : detail}
                </p>
              </div>
              <span className="events-summary-arrow" aria-hidden="true">
                <ChevronRight />
              </span>
            </section>
          ))}
        </div>
      </header>
      <div className="events-body">
        <svg
          className="events-botanical"
          viewBox="0 0 160 300"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M18 290C85 235 68 153 139 15" fill="none" stroke="currentColor" strokeWidth="2" />
          {[0, 1, 2, 3, 4, 5, 6].map((leaf) => (
            <g key={leaf} transform={`translate(${42 + leaf * 12}, ${252 - leaf * 34})`}>
              <path d="M0 0C-34-6-38-26-35-37C-13-33-3-17 0 0Z" />
              <path d="M0 0C27-4 39-20 37-35C14-31 3-16 0 0Z" />
            </g>
          ))}
        </svg>
        <div className="events-toolbar">
          <FilterChips
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            label="Date range"
          />
          <div className="events-search-sort">
            <div className="events-search">
              <Search aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search events, title or description..."
                aria-label="Search events"
              />
            </div>
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger aria-label="Sort events">
                <ArrowUpDown className="size-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start-asc">Soonest first</SelectItem>
                <SelectItem value="start-desc">Latest first</SelectItem>
                <SelectItem value="booked-desc">Most booked</SelectItem>
                <SelectItem value="confirmed-desc">Most confirmed</SelectItem>
                <SelectItem value="name-asc">Name A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => events.refetch()} />
        ) : loading ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="No events match these filters"
            description="Try a wider date range, or run a sync in Admin settings to import the latest events."
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="events-mobile-list space-y-3 lg:hidden">
              {rows.map(({ event, stats }) => (
                <article key={event.id} className="surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-semibold leading-snug text-foreground">
                      {event.event_name}
                    </h2>
                    <SoftBadge tone={event.status === "live" ? "success" : "neutral"}>
                      {event.status ?? "unknown"}
                    </SoftBadge>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatDateTime(event.start_at)} · {event.timezone ?? "Europe/London"}
                  </p>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      ["Booked", stats.booked],
                      ["Confirmed", stats.confirmed],
                      ["Declined", stats.declined],
                      ["Pending", stats.pending],
                    ].map(([label, value]) => (
                      <div key={label as string} className="rounded-lg bg-muted/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                          {label}
                        </p>
                        <p className="text-sm font-semibold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button asChild size="sm" className="flex-1">
                      <Link to="/events/$eventId" params={{ eventId: event.id }}>
                        Open event
                      </Link>
                    </Button>
                    {event.meeting_url ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={event.meeting_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {/* Desktop table */}
            <div className="events-table surface hidden overflow-hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Event
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Starts
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Booked
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Confirmed
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Declined
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Pending
                    </th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(({ event, stats }) => (
                    <tr key={event.id} className="transition-colors hover:bg-lav-50/60">
                      <td className="max-w-[26rem] px-4 py-3">
                        <Link
                          to="/events/$eventId"
                          params={{ eventId: event.id }}
                          className="focus-ring font-medium text-foreground hover:text-primary"
                        >
                          {event.event_name}
                        </Link>
                        {event.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {event.description}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        <EventStart start={event.start_at} end={event.end_at} />
                      </td>
                      <td className="px-4 py-3">
                        <SoftBadge tone={event.status === "live" ? "success" : "neutral"}>
                          {event.status ?? "unknown"}
                        </SoftBadge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">
                        {stats.booked}
                      </td>
                      <td className="px-4 py-3 text-right text-success">{stats.confirmed}</td>
                      <td className="px-4 py-3 text-right text-destructive">{stats.declined}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {stats.pending}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/events/$eventId" params={{ eventId: event.id }}>
                            Open
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
