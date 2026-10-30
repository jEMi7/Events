import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  UsersRound,
  CheckCheck,
  UserRoundCheck,
  CircleHelp,
  ChartNoAxesCombined,
  CalendarDays,
  ArrowRight,
  Download,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingCards } from "@/components/data-states";
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
import { formatShort } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/export-attendees";
import { buildReportCsv, reportCsvFilename } from "@/lib/export-reports";
import "@/styles/reports.css";

function EventMetricSparkline({
  values,
  color,
  id,
}: {
  values: (number | null)[];
  color: string;
  id: string;
}) {
  // Current per-event values, never a fabricated time series or historical trend.
  if (values.filter((value) => value !== null).length < 2) return null;
  const maximum = Math.max(...values.filter((value): value is number => value !== null), 1);
  const points = values.map((value, index) =>
    value === null
      ? null
      : { x: (index / Math.max(values.length - 1, 1)) * 110, y: 56 - (value / maximum) * 42 },
  );
  const segments: string[] = [];
  let segment = "";
  for (const point of points) {
    if (point) segment += `${segment ? "L" : "M"}${point.x},${point.y} `;
    else if (segment) {
      segments.push(segment);
      segment = "";
    }
  }
  if (segment) segments.push(segment);
  return (
    <span
      className="reports-mini-chart"
      title="Current selected events, in table order; not a historical trend"
    >
      <svg viewBox="0 0 110 70" fill="none">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={color} stopOpacity=".28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {segments.map((path, index) => (
          <path key={index} d={path} stroke={color} strokeWidth="1.5" />
        ))}
        {points.every((point) => point !== null) && (
          <path d={`${segments[0]} L110,70 L0,70Z`} fill={`url(#${id})`} />
        )}
      </svg>
      <small>By event</small>
    </span>
  );
}

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Event Attendance Hub" },
      {
        name: "description",
        content:
          "Compare events on booked, confirmed and attended figures from saved staff outcomes.",
      },
      { property: "og:title", content: "Reports — Event Attendance Hub" },
      {
        property: "og:description",
        content: "Confirmation, show-up and no-answer rates calculated from real recorded data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const [range, setRange] = useState<RangeKey>("all");
  const [eventId, setEventId] = useState<string>("all");
  const events = useEvents();
  const bookings = useBookings();

  const model = useMemo(() => {
    const scopedEvents = sortByStart(filterEventsByRange(events.data ?? [], range), "desc");
    const chosen = eventId === "all" ? scopedEvents : scopedEvents.filter((e) => e.id === eventId);
    const ids = new Set(chosen.map((event) => event.id));
    const scopedBookings = (bookings.data ?? []).filter((booking) => ids.has(booking.event_id));
    const byEvent = groupByEvent(scopedBookings);

    return {
      scopedEvents,
      chosen,
      overall: statsFor(scopedBookings),
      rows: chosen.map((event) => ({ event, stats: statsFor(byEvent.get(event.id) ?? []) })),
    };
  }, [events.data, bookings.data, range, eventId]);

  const funnel = [
    { stage: "Booked", value: model.overall.booked, fill: "url(#reports-funnel-booked)" },
    { stage: "Confirmed", value: model.overall.confirmed, fill: "url(#reports-funnel-confirmed)" },
    { stage: "Attended", value: model.overall.attended, fill: "url(#reports-funnel-attended)" },
  ];

  const comparisonStats = new Map(model.rows.map((row) => [row.event.id, row.stats]));
  const comparison = sortByStart(model.chosen, "asc").map((event) => {
    const stats = comparisonStats.get(event.id)!;
    return {
      fullName: event.event_name,
      name: formatShort(event.start_at).split(",")[0],
      Booked: stats.booked,
      Confirmed: stats.confirmed,
      Attended: stats.attended,
    };
  });

  const loading = events.isLoading || bookings.isLoading;
  const error = events.error ?? bookings.error;

  const eventSelector = (label: string, summary?: string) => (
    <Select value={eventId} onValueChange={setEventId}>
      <SelectTrigger aria-label={label}>
        <CalendarDays aria-hidden="true" />
        <SelectValue placeholder="Choose an event">{summary}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All events in range</SelectItem>
        {model.scopedEvents.map((event) => (
          <SelectItem key={event.id} value={event.id}>
            {event.event_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="reports-view">
      <header className="reports-hero">
        <svg
          className="reports-ribbon"
          aria-hidden="true"
          viewBox="0 0 1100 240"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="reports-ribbon-fill" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#f9f7ff" />
              <stop offset="1" stopColor="#d5c7ff" />
            </linearGradient>
          </defs>
          <path d="M0-80C250-20 430 120 650 160S980 80 1100-50V0H0Z" fill="#fff9" />
          <path
            d="M520-20C610 65 690 95 750 132S770 220 850 166 995 110 1100-10V-30Z"
            fill="url(#reports-ribbon-fill)"
          />
          <path
            d="M722 109c-70-30-98-76-111-40s25 48 99 85c29 15 8-16 12-45Z"
            fill="#cdbbff"
            fillOpacity=".65"
          />
          <path
            d="M150-25C430 200 610 125 1100 230"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeOpacity=".8"
          />
          <path
            d="M700 40L755 93L812 65L870 125L940 46"
            fill="none"
            stroke="#b99adf"
            strokeWidth="4"
            strokeDasharray="8 9"
            strokeLinecap="round"
            opacity=".35"
          />
          <circle cx="1010" cy="80" r="78" fill="none" stroke="#d5bfed" opacity=".4" />
          <circle cx="1010" cy="80" r="52" fill="none" stroke="#d5bfed" opacity=".4" />
        </svg>
        <p className="reports-eyebrow">
          Event Registrations Hub <span />
        </p>
        <PageHeader
          title="Reports"
          description="Event performance, from first registration to final attendance — all in one view."
          actions={
            <div className="reports-header-actions">
              {eventSelector("Filter by event")}
              <Button
                className="reports-export"
                disabled={loading || Boolean(error) || model.rows.length === 0}
                onClick={() => downloadCsv(reportCsvFilename(range), buildReportCsv(model.rows))}
              >
                <Download aria-hidden="true" /> Export report
              </Button>
            </div>
          }
        />

        <div className="reports-date-filters">
          <FilterChips
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            label="Date range"
          />
        </div>
      </header>
      <div className="reports-body">
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => events.refetch()} />
        ) : loading ? (
          <LoadingCards count={4} />
        ) : model.overall.booked === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-5" />}
            title="No data for this selection"
            description="Choose a wider range, or import registrations from Admin settings."
          />
        ) : (
          <div className="reports-content">
            <div className="reports-kpis">
              <KpiCard
                label="Registrations"
                value={model.overall.booked}
                hint={`Across ${model.chosen.length} selected events`}
                accent="purple"
                icon={<UsersRound aria-hidden="true" />}
                decoration={
                  <EventMetricSparkline
                    values={model.rows.map((row) => row.stats.booked)}
                    color="#9162fa"
                    id="reports-mini-booked"
                  />
                }
              />
              <KpiCard
                label="Confirmation rate"
                accent="green"
                icon={<CheckCheck aria-hidden="true" />}
                decoration={
                  <EventMetricSparkline
                    values={model.rows.map((row) => row.stats.confirmationRate)}
                    color="#46d992"
                    id="reports-mini-green"
                  />
                }
                value={`${model.overall.confirmationRate}%`}
                hint={`${model.overall.confirmed} confirmed`}
              />
              <KpiCard
                label="Show-up rate"
                accent="blue"
                icon={<UserRoundCheck aria-hidden="true" />}
                decoration={
                  model.overall.attended + model.overall.absent === 0 ? (
                    <span className="reports-no-data">No data yet</span>
                  ) : (
                    <EventMetricSparkline
                      values={model.rows.map((row) =>
                        row.stats.attended + row.stats.absent > 0 ? row.stats.showUpRate : null,
                      )}
                      color="#68a4ff"
                      id="reports-mini-blue"
                    />
                  )
                }
                value={
                  model.overall.attended + model.overall.absent > 0
                    ? `${model.overall.showUpRate}%`
                    : "—"
                }
                hint={`${model.overall.attended} attended · ${model.overall.absent} absent`}
              />
              <KpiCard
                label="No answer rate"
                accent="orange"
                icon={<CircleHelp aria-hidden="true" />}
                decoration={
                  <EventMetricSparkline
                    values={model.rows.map((row) => row.stats.noAnswerRate)}
                    color="#ff9945"
                    id="reports-mini-orange"
                  />
                }
                value={`${model.overall.noAnswerRate}%`}
                hint={`${model.overall.noAnswer} could not be reached`}
              />
            </div>

            <div className="reports-section-heading reports-overview-heading">
              <h2>Performance overview</h2>
              <p>Across your selected event registrations</p>
              <span>Based on saved records</span>
            </div>
            <div className="reports-charts">
              <section className="reports-chart reports-funnel surface">
                <div className="reports-chart-heading">
                  <span>
                    <BarChart3 aria-hidden="true" />
                  </span>
                  <h2>Overall funnel</h2>
                  {eventSelector(
                    "Event for overall funnel",
                    `${model.chosen.length} ${model.chosen.length === 1 ? "event" : "events"} included`,
                  )}
                </div>
                <p className="reports-chart-subtitle">
                  Bookings progressing through confirmation and attendance
                </p>
                <div className="reports-plot">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnel} margin={{ top: 26, right: 18, bottom: 4, left: -12 }}>
                      <defs>
                        <linearGradient id="reports-funnel-booked" x1="0" y1="0" x2="0" y2="1">
                          <stop stopColor="#cbb2ff" />
                          <stop offset="1" stopColor="#b69af3" />
                        </linearGradient>
                        <linearGradient id="reports-funnel-confirmed" x1="0" y1="0" x2="0" y2="1">
                          <stop stopColor="#b391ff" />
                          <stop offset="1" stopColor="#9d73ed" />
                        </linearGradient>
                        <linearGradient id="reports-funnel-attended" x1="0" y1="0" x2="0" y2="1">
                          <stop stopColor="#66d8af" />
                          <stop offset="1" stopColor="#26b98a" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 3" stroke="#e9e6f3" vertical={false} />
                      <XAxis
                        dataKey="stage"
                        tickLine={false}
                        axisLine={{ stroke: "#cdd5e9" }}
                        fontSize={11}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={{ stroke: "#cdd5e9" }}
                        fontSize={11}
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
                        radius={[5, 5, 0, 0]}
                        maxBarSize={115}
                        isAnimationActive={false}
                      >
                        <LabelList
                          dataKey="value"
                          position="top"
                          fill="#181841"
                          fontSize={12}
                          fontWeight={600}
                        />
                        {funnel.map((entry) => (
                          <Cell key={entry.stage} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="reports-chart reports-comparison surface">
                <div className="reports-chart-heading">
                  <span>
                    <ChartNoAxesCombined aria-hidden="true" />
                  </span>
                  <h2>Event comparison</h2>
                  {eventSelector("Event for comparison chart", "By event date")}
                </div>
                <p className="reports-chart-subtitle">
                  Booked registrations compared with confirmed attendance intent
                </p>
                <div className="reports-plot">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={comparison}
                      margin={{ top: 10, right: 12, bottom: 0, left: -16 }}
                    >
                      <defs>
                        <linearGradient id="reports-comparison-booked" x1="0" y1="0" x2="0" y2="1">
                          <stop stopColor="#b89aff" />
                          <stop offset="1" stopColor="#9f79ee" />
                        </linearGradient>
                        <linearGradient
                          id="reports-comparison-confirmed"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop stopColor="#67dbad" />
                          <stop offset="1" stopColor="#2abf8a" />
                        </linearGradient>
                        <linearGradient
                          id="reports-comparison-attended"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop stopColor="#3ecab8" />
                          <stop offset="1" stopColor="#169e91" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 3" stroke="#e9e6f3" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        interval={0}
                        angle={0}
                        textAnchor="middle"
                        tickFormatter={(name: string) =>
                          name.length > 18 ? `${name.slice(0, 18)}…` : name
                        }
                        height={30}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={{ stroke: "#cdd5e9" }}
                        fontSize={11}
                        allowDecimals={false}
                      />
                      <ChartTooltip
                        labelFormatter={(label, payload) =>
                          payload?.[0]?.payload?.fullName ?? label
                        }
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid var(--color-border)",
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        align="right"
                        iconType="circle"
                        iconSize={9}
                        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      />
                      <Bar
                        dataKey="Booked"
                        fill="url(#reports-comparison-booked)"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={24}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="Confirmed"
                        fill="url(#reports-comparison-confirmed)"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={24}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="Attended"
                        fill="url(#reports-comparison-attended)"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={24}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <div className="reports-section-heading reports-performance-heading">
              <h2>Event performance</h2>
              <b>
                {model.chosen.length} {model.chosen.length === 1 ? "event" : "events"}
              </b>
              <p>
                All figures calculated from saved records <span aria-hidden="true">•</span> Scroll
                to explore
              </p>
            </div>
            <section
              className="reports-table-scroll surface"
              aria-label="Event report records"
              tabIndex={0}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    {[
                      "Event",
                      "Starts",
                      "Booked",
                      "Confirmed",
                      "Declined",
                      "Pending",
                      "Attended",
                      "Absent",
                      "Confirm %",
                      "Show-up",
                      "Actions",
                    ].map((label) => (
                      <th
                        key={label}
                        className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {model.rows.map(({ event, stats }) => (
                    <tr key={event.id} className="hover:bg-lav-50/60">
                      <td className="max-w-[22rem] px-4 py-3">
                        <Link
                          to="/events/$eventId"
                          params={{ eventId: event.id }}
                          className="reports-event-name"
                          title={event.event_name}
                        >
                          <CalendarDays aria-hidden="true" />
                          <span>{event.event_name}</span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatShort(event.start_at)}
                      </td>
                      <td className="px-4 py-3">{stats.booked}</td>
                      <td className="px-4 py-3 text-success">{stats.confirmed}</td>
                      <td className="px-4 py-3 text-destructive">{stats.declined}</td>
                      <td className="px-4 py-3 text-muted-foreground">{stats.pending}</td>
                      <td className="px-4 py-3">{stats.attended}</td>
                      <td className="px-4 py-3">{stats.absent}</td>
                      <td className="px-4 py-3 font-medium">{stats.confirmationRate}%</td>
                      <td className="px-4 py-3 font-medium">
                        {stats.attended + stats.absent > 0 ? `${stats.showUpRate}%` : "—"}
                      </td>
                      <td>
                        <Button asChild size="sm" variant="ghost" className="reports-details">
                          <Link to="/events/$eventId" params={{ eventId: event.id }}>
                            View details
                            <ArrowRight aria-hidden="true" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
