import type { EventStats } from "./analytics";
import type { EventRecord } from "./queries";

type ReportExportRow = {
  event: Pick<EventRecord, "event_name" | "start_at">;
  stats: EventStats;
};

function reportCell(value: string | number | null) {
  let text = value === null ? "" : String(value);
  // Keep saved event titles as spreadsheet text, including formula-like titles.
  if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildReportCsv(rows: ReportExportRow[]) {
  const headers = [
    "Event",
    "Starts",
    "Booked",
    "Confirmed",
    "Declined",
    "Pending",
    "Attended",
    "Absent",
    "Confirmation (%)",
    "Show-up (%)",
  ];
  return [
    headers.map(reportCell).join(","),
    ...rows.map(({ event, stats }) =>
      [
        event.event_name,
        event.start_at,
        stats.booked,
        stats.confirmed,
        stats.declined,
        stats.pending,
        stats.attended,
        stats.absent,
        stats.confirmationRate,
        stats.attended + stats.absent > 0 ? stats.showUpRate : null,
      ]
        .map(reportCell)
        .join(","),
    ),
  ].join("\r\n");
}

export function reportCsvFilename(range: string) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `event-report-${range}-${stamp}.csv`;
}
