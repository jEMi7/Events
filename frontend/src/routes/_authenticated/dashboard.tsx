import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  PhoneCall,
  Users,
  ArrowRight,
  Bell,
  ChartNoAxesColumnIncreasing,
  CircleX,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { KpiCard, MiniStat } from "@/components/kpi-card";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingCards, LoadingRows } from "@/components/data-states";
import { IntentBadge, SoftBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useActivity, useBookings, useCallbacks, useEvents } from "@/lib/queries";
import {
  RANGE_OPTIONS,
  filterEventsByRange,
  groupByEvent,
  sortByStart,
  statsFor,
} from "@/lib/analytics";
import type { RangeKey } from "@/lib/analytics";
import { formatDateTime, formatShort, relativeFromNow } from "@/lib/domain";
import "@/styles/dashboard.css";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Event Attendance Hub" },
      {
        name: "description",
        content: "Live confirmation, call back and attendance figures across your upcoming events.",
      },
      { property: "og:title", content: "Dashboard — Event Attendance Hub" },
      {
        property: "og:description",
        content: "Live confirmation, call back and attendance figures for event teams.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const ACTION_LABELS: Record<string, string> = {
  intent_updated: "updated attendance intent",
  attendance_updated: "recorded attendance",
  note_added: "added a note",
  callback_scheduled: "scheduled a call back",
  callback_completed: "completed a call back",
  callback_rescheduled: "rescheduled a call back",
};

// Decorative motifs only; all displayed statistics and analytics come from the model below.
function StatDecoration({ kind }: { kind: "calendar" | "bars" | "wave" | "people" }) {
  if (kind === "calendar") return <CalendarDays />;
  if (kind === "people") return <Users />;
  return kind === "bars" ? (
    <svg viewBox="0 0 80 64" fill="currentColor">
      <rect x="8" y="38" width="16" height="24" rx="3" />
      <rect x="32" y="24" width="16" height="38" rx="3" />
      <rect x="56" y="4" width="16" height="58" rx="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 110 54" fill="none">
      <path
        d="M2 26C16 26 14 50 32 48S52 12 70 24s18 20 38-14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GoldSprig() {
  return (
    <svg className="dashboard-gold-sprig" viewBox="0 0 100 180" fill="none" aria-hidden="true">
      <path d="M12 174C62 137 45 77 85 8" stroke="currentColor" strokeWidth="1.5" />
      {[25, 49, 73, 97, 121, 145].map((y, i) => (
        <g key={y} transform={`translate(${77 - i * 9} ${y}) rotate(${i * 4 - 13})`}>
          <ellipse cx="-7" cy="-9" rx="5" ry="12" fill="currentColor" transform="rotate(-32)" />
          <ellipse cx="12" cy="10" rx="5" ry="12" fill="currentColor" transform="rotate(34)" />
        </g>
      ))}
    </svg>
  );
}

function Dashboard() {
  const [range, setRange] = useState<RangeKey>("30");
  const [workloadWidth, setWorkloadWidth] = useState(0);
  const events = useEvents();
  const bookings = useBookings();
  const callbacks = useCallbacks();
  const activity = useActivity({ limit: 12 });

  const model = useMemo(() => {
    const allEvents = events.data ?? [];
    const inRange = sortByStart(filterEventsByRange(allEvents, range));
    const eventIds = new Set(inRange.map((event) => event.id));
    const scoped = (bookings.data ?? []).filter((booking) => eventIds.has(booking.event_id));
    const byEvent = groupByEvent(scoped);
    const stats = statsFor(scoped);
    const nextEvent = sortByStart(
      allEvents.filter(
        (event) => event.start_at && new Date(event.start_at).getTime() >= Date.now(),
      ),
    )[0];
    const nextEventBookings = nextEvent
      ? (bookings.data ?? []).filter((booking) => booking.event_id === nextEvent.id)
      : [];

    const openCallbacks = (callbacks.data ?? []).filter((task) => task.status === "open");
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const dueToday = openCallbacks.filter(
      (task) => new Date(task.due_at).getTime() <= endOfToday.getTime(),
    );

    return {
      inRange,
      scoped,
      byEvent,
      stats,
      nextEvent,
      nextEventStats: statsFor(nextEventBookings),
      openCallbacks,
      dueToday,
    };
  }, [events.data, bookings.data, callbacks.data, range]);

  const funnelData = [
    { stage: "Booked", value: model.stats.booked, fill: "url(#dashboard-booked-gradient)" },
    {
      stage: "Confirmed",
      value: model.stats.confirmed,
      fill: "url(#dashboard-confirmed-gradient)",
    },
    { stage: "Attended", value: model.stats.attended, fill: "url(#dashboard-attended-gradient)" },
  ];

  const workloadData = model.inRange.slice(0, 8).map((event) => {
    const stats = statsFor(model.byEvent.get(event.id) ?? []);
    return {
      name: event.event_name.length > 26 ? `${event.event_name.slice(0, 26)}…` : event.event_name,
      Pending: stats.pending,
      Confirmed: stats.confirmed,
    };
  });

  const loading = events.isLoading || bookings.isLoading;
  const error = events.error ?? bookings.error;

  return (
    <div className="dashboard-view">
      <header className="dashboard-hero">
        <img
          className="dashboard-hero-photo"
          src="/images/dashboard-header-building.png"
          alt=""
          fetchPriority="high"
        />
        <svg
          className="dashboard-hero-ribbons"
          viewBox="0 0 1400 240"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 80C160-75 280-32 510 101S663 240 820 238C542 132 352-123 0 23Z"
            fill="#d9c9ec"
            fillOpacity=".44"
          />
          <path
            d="M0 54C176-68 320 0 518 120S697 243 850 231C629 166 447-10 240 0S69 29 0 54"
            fill="#fff8f2"
            fillOpacity=".7"
          />
        </svg>
        <div className="dashboard-hero-brand" aria-hidden="true">
          <span>Kent</span>
          <p>Always a step ahead</p>
          <i />
        </div>
        <p className="dashboard-eyebrow">
          Event Registrations Hub <span />
        </p>
        <PageHeader
          title="Dashboard"
          description="Confirmation and attendance performance across your event pipeline."
          actions={
            <FilterChips
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              label="Date range"
            />
          }
        />
      </header>

      {error ? (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => {
            events.refetch();
            bookings.refetch();
          }}
        />
      ) : loading ? (
        <div className="space-y-4">
          <LoadingCards count={4} />
          <LoadingCards count={4} />
        </div>
      ) : (
        <div className="dashboard-content">
          <div className="dashboard-kpis grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Upcoming events"
              value={model.inRange.length}
              hint={RANGE_OPTIONS.find((option) => option.key === range)?.label}
              icon={<CalendarDays className="size-4" />}
              tone="wash"
              accent="purple"
              decoration={<StatDecoration kind="calendar" />}
            />
            <KpiCard
              label="Registrations"
              value={model.stats.booked}
              hint={`${model.stats.notContacted} not contacted yet`}
              icon={<Users className="size-4" />}
              accent="purple"
              decoration={<StatDecoration kind="bars" />}
            />
            <KpiCard
              label="Confirmed"
              value={model.stats.confirmed}
              hint={`${model.stats.confirmationRate}% of registrations`}
              icon={<CheckCircle2 className="size-4" />}
              accent="green"
              decoration={<StatDecoration kind="wave" />}
            />
            <KpiCard
              label="Declined"
              value={model.stats.declined}
              hint={`${model.stats.cancelled} cancelled`}
              icon={<CircleX className="size-4" />}
              accent="rose"
              decoration={<StatDecoration kind="wave" />}
            />
            <KpiCard
              label="Pending contact"
              value={model.stats.pending}
              hint="Not contacted, maybe, no answer or call back"
              icon={<PhoneCall className="size-4" />}
              accent="orange"
              decoration={<StatDecoration kind="people" />}
            />
            <KpiCard
              label="Call backs due"
              value={model.dueToday.length}
              hint={`${model.openCallbacks.length} open in total`}
              icon={<PhoneCall className="size-4" />}
              accent="purple"
              decoration={<StatDecoration kind="bars" />}
            />
            <KpiCard
              label="Confirmation rate"
              value={`${model.stats.confirmationRate}%`}
              hint={`${model.stats.noAnswerRate}% no answer`}
              icon={<ChartNoAxesColumnIncreasing className="size-4" />}
              accent="purple"
              decoration={<StatDecoration kind="wave" />}
            />
            <KpiCard
              label="Show-up rate"
              value={
                model.stats.attended + model.stats.absent > 0 ? `${model.stats.showUpRate}%` : "—"
              }
              hint={
                model.stats.attended + model.stats.absent > 0
                  ? `${model.stats.attended} attended · ${model.stats.absent} absent`
                  : "Recorded after events run"
              }
              icon={<Users className="size-4" />}
              accent="blue"
              decoration={<StatDecoration kind="bars" />}
            />
          </div>

          <div className="dashboard-overview">
            <section
              className="dashboard-next-event surface p-5"
              aria-labelledby="next-event-heading"
            >
              <GoldSprig />
              <h2 id="next-event-heading" className="dashboard-next-badge">
                Next event
              </h2>
              {model.nextEvent ? (
                <>
                  <h3 className="dashboard-next-title">{model.nextEvent.event_name}</h3>
                  <p className="dashboard-next-date">
                    <CalendarDays aria-hidden="true" />
                    {formatDateTime(model.nextEvent.start_at)} ·{" "}
                    {relativeFromNow(model.nextEvent.start_at)}
                  </p>
                  <div className="dashboard-next-stats">
                    <MiniStat
                      label="Booked"
                      value={model.nextEventStats.booked}
                      icon={<Users />}
                      accent="purple"
                    />
                    <MiniStat
                      label="Confirmed"
                      value={model.nextEventStats.confirmed}
                      icon={<CheckCircle2 />}
                      accent="green"
                    />
                    <MiniStat
                      label="Pending"
                      value={model.nextEventStats.pending}
                      icon={<Clock3 />}
                      accent="orange"
                    />
                    <MiniStat
                      label="Declined"
                      value={model.nextEventStats.declined}
                      icon={<CircleX />}
                      accent="rose"
                    />
                  </div>
                  <div className="dashboard-next-actions">
                    <Button asChild size="sm">
                      <Link to="/events/$eventId" params={{ eventId: model.nextEvent.id }}>
                        Open event <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                    </Button>
                    {model.nextEvent.meeting_url ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={model.nextEvent.meeting_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" /> Meeting link
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState
                  title="No upcoming events"
                  description="Run a sync in Admin settings to import the latest events."
                />
              )}
            </section>

            <section className="dashboard-panel dashboard-funnel surface p-5">
              <GoldSprig />
              <div className="dashboard-panel-heading">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    <ChartNoAxesColumnIncreasing aria-hidden="true" /> Booking → confirmation →
                    attendance
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Based on saved staff outcomes for the selected range.
                  </p>
                </div>
                <label className="dashboard-chart-range">
                  <span className="sr-only">Chart date range</span>
                  <select
                    value={range}
                    onChange={(event) => setRange(event.target.value as RangeKey)}
                  >
                    {RANGE_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="dashboard-funnel-chart">
                {model.stats.booked === 0 ? (
                  <EmptyState title="No registrations in this range" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={funnelData}
                      margin={{ top: 24, right: 12, bottom: 0, left: -18 }}
                    >
                      <defs>
                        <linearGradient id="dashboard-booked-gradient" x1="0" y1="0" x2="0" y2="1">
                          <stop stopColor="#ad92eb" />
                          <stop offset="1" stopColor="#bdabec" />
                        </linearGradient>
                        <linearGradient
                          id="dashboard-confirmed-gradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop stopColor="#8052bb" />
                          <stop offset="1" stopColor="#a187d5" />
                        </linearGradient>
                        <linearGradient
                          id="dashboard-attended-gradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop stopColor="#8f74c2" />
                          <stop offset="1" stopColor="#b7a2dd" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        vertical={false}
                      />
                      <XAxis dataKey="stage" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        allowDecimals={false}
                      />
                      <ChartTooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid var(--color-border)",
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="value"
                        name="Attendees"
                        barSize={108}
                        radius={[5, 5, 0, 0]}
                        isAnimationActive={false}
                      >
                        <LabelList
                          dataKey="value"
                          position="top"
                          offset={8}
                          className="dashboard-chart-label"
                        />
                        {funnelData.map((entry) => (
                          <Cell key={entry.stage} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>

          <div className="dashboard-analysis-row">
            <section className="dashboard-panel dashboard-workload surface p-5">
              <GoldSprig />
              <div className="dashboard-panel-heading">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    <ChartNoAxesColumnIncreasing aria-hidden="true" /> Upcoming workload
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pending versus confirmed registrations per event.
                  </p>
                </div>
                <ul className="dashboard-chart-legend" aria-label="Workload chart legend">
                  <li>
                    <span className="legend-pending" />
                    Pending
                  </li>
                  <li>
                    <span className="legend-confirmed" />
                    Confirmed
                  </li>
                </ul>
              </div>
              <div
                className="dashboard-workload-chart"
                style={{ height: Math.max(132, workloadData.length * 44) }}
              >
                {workloadData.length === 0 ? (
                  <EmptyState title="Nothing scheduled in this range" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%" onResize={setWorkloadWidth}>
                    <BarChart
                      data={workloadData}
                      layout="vertical"
                      margin={{ top: 4, right: 30, bottom: 0, left: 0 }}
                      barSize={34}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={workloadWidth > 0 && workloadWidth < 350 ? 100 : 140}
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                      />
                      <ChartTooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid var(--color-border)",
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="Confirmed"
                        stackId="a"
                        fill="var(--lav-500)"
                        radius={[0, 0, 0, 0]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="Pending"
                        stackId="a"
                        fill="var(--lav-300)"
                        radius={[0, 6, 6, 0]}
                        isAnimationActive={false}
                      >
                        <LabelList
                          dataKey={(entry) => entry["Pending"] + entry["Confirmed"]}
                          position="right"
                          offset={8}
                          className="dashboard-chart-label"
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="dashboard-panel dashboard-action-panel surface p-5">
              <GoldSprig />
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">
                  <Bell aria-hidden="true" /> Needs action today
                </h2>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/callbacks">
                    All call backs <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4">
                {callbacks.isLoading ? (
                  <LoadingRows rows={4} />
                ) : model.dueToday.length === 0 ? (
                  <EmptyState
                    title="Nothing overdue"
                    description="Call backs scheduled for today or earlier appear here."
                    icon={<Bell className="size-5" />}
                  />
                ) : (
                  <ul className="space-y-2.5">
                    {model.dueToday.slice(0, 6).map((task) => (
                      <li
                        key={task.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {task.booking?.person?.full_name ?? "Attendee"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {task.booking?.event?.event_name ?? "Event"} · due{" "}
                            {formatShort(task.due_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SoftBadge
                            tone={new Date(task.due_at).getTime() < Date.now() ? "danger" : "info"}
                          >
                            {new Date(task.due_at).getTime() < Date.now() ? "Overdue" : "Today"}
                          </SoftBadge>
                          {task.booking?.event ? (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to="/events/$eventId"
                                params={{ eventId: task.booking.event.id }}
                              >
                                Open
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <div className="dashboard-history-row">
            <section className="dashboard-panel dashboard-upcoming surface p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">Upcoming events</h2>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/events">View all</Link>
                </Button>
              </div>
              <div className="mt-4">
                {model.inRange.length === 0 ? (
                  <EmptyState title="No events in this range" />
                ) : (
                  <ul className="divide-y divide-border">
                    {model.inRange.slice(0, 6).map((event) => {
                      const stats = statsFor(model.byEvent.get(event.id) ?? []);
                      return (
                        <li
                          key={event.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 sm:gap-4"
                        >
                          <div className="min-w-0">
                            <Link
                              to="/events/$eventId"
                              params={{ eventId: event.id }}
                              className="focus-ring line-clamp-2 block text-sm font-medium leading-snug text-foreground hover:text-primary sm:truncate"
                            >
                              {event.event_name}
                            </Link>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDateTime(event.start_at)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <SoftBadge tone="neutral">{stats.booked} booked</SoftBadge>
                            <SoftBadge tone="success">{stats.confirmed}</SoftBadge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section className="dashboard-panel dashboard-activity surface p-5">
              <h2 className="text-sm font-semibold text-foreground">Recent team activity</h2>
              <div className="mt-4">
                {activity.isLoading ? (
                  <LoadingRows rows={4} />
                ) : (activity.data ?? []).length === 0 ? (
                  <EmptyState
                    title="No activity yet"
                    description="Actions recorded by your team appear here."
                  />
                ) : (
                  <ol className="space-y-3">
                    {activity.data!.map((item) => (
                      <li key={item.id} className="flex items-start gap-3">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-lav-300" />
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">{item.actor?.full_name ?? "Staff"}</span>{" "}
                            {ACTION_LABELS[item.action] ?? item.action}
                            {item.person?.full_name ? ` for ${item.person.full_name}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(item.created_at)}
                            {item.event?.event_name ? ` · ${item.event.event_name}` : ""}
                          </p>
                          {item.detail && typeof item.detail["intent"] === "string" ? (
                            <div className="mt-1">
                              <IntentBadge value={item.detail["intent"] as never} />
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
