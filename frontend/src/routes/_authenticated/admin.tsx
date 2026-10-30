import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MiniStat } from "@/components/kpi-card";
import { EmptyState, ErrorState, LoadingRows } from "@/components/data-states";
import { SoftBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useCurrentStaff } from "@/hooks/use-auth";
import { useHeaderMappings, useSyncRuns } from "@/lib/queries";
import { getSourceStatus, runSourceSync } from "@/lib/sync.functions";
import { formatDateTime } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin settings — Event Attendance Hub" },
      {
        name: "description",
        content: "Manage the Google Sheets source connection, column mapping and sync history.",
      },
      { property: "og:title", content: "Admin settings — Event Attendance Hub" },
      {
        property: "og:description",
        content: "Source connection, manual sync, mapping status and run history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const staff = useCurrentStaff();
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getSourceStatus);
  const runSync = useServerFn(runSourceSync);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["source-status"],
    queryFn: () => fetchStatus({}),
  });

  const runs = useSyncRuns();
  const mappings = useHeaderMappings();

  const sync = useMutation({
    mutationFn: () => runSync({}),
    onSuccess: (result: any) => {
      setLastResult(
        `Imported ${result.events_read} event rows and ${result.attendees_read} attendee rows. ` +
          `${result.events_upserted} events, ${result.people_upserted} people and ${result.bookings_upserted} registrations updated.`,
      );
      toast.success("Sync completed");
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setLastResult(null);
      toast.error(error.message);
    },
  });

  if (staff.data && !staff.data.isAdmin) {
    return (
      <>
        <PageHeader title="Admin settings" />
        <EmptyState
          icon={<ShieldCheck className="size-5" />}
          title="Administrator access required"
          description="Ask an administrator to run syncs or change source settings."
        />
      </>
    );
  }

  const source = status.data?.source;
  const connected = status.data?.connected;
  const lastSuccess = (runs.data ?? []).find((run) => run.status === "success");

  return (
    <>
      <PageHeader
        title="Admin settings"
        description="Source connection, column mapping and sync history."
        actions={
          <Button disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={sync.isPending ? "size-4 animate-spin" : "size-4"} />
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        }
      />

      <div className="space-y-5">
        <section className="surface lav-wash p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Database className="size-4 text-primary" /> Google Sheets source
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Spreadsheet ID:{" "}
                <span className="font-mono text-xs">{source?.spreadsheet_id ?? "—"}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <SoftBadge tone="lavender">{source?.events_tab ?? "Upcoming_Events_Raw"}</SoftBadge>
                <SoftBadge tone="lavender">
                  {source?.attendees_tab ?? "Upcoming_Attendees_Raw"}
                </SoftBadge>
              </div>
            </div>
            <div>
              {status.isLoading ? (
                <SoftBadge tone="neutral">Checking connection…</SoftBadge>
              ) : connected ? (
                <SoftBadge tone="success">
                  <CheckCircle2 className="size-3.5" /> Connected
                </SoftBadge>
              ) : (
                <SoftBadge tone="warning">
                  <AlertTriangle className="size-3.5" /> Not connected
                </SoftBadge>
              )}
            </div>
          </div>

          <p className="mt-4 rounded-xl border border-lav-200 bg-card px-4 py-3 text-sm text-muted-foreground">
            Source rows are read-only. Team actions are stored separately and protected from source
            syncs.
          </p>

          {!connected && !status.isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">
              The Google Sheets connection is not available to this app yet. Once an administrator
              authorises it, Sync now will import both tabs. Nothing is ever written back to the
              spreadsheet.
            </p>
          ) : null}

          {status.error ? (
            <div className="mt-4">
              <ErrorState
                message={(status.error as Error).message}
                onRetry={() => status.refetch()}
              />
            </div>
          ) : null}
        </section>

        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Last sync</h2>
          {runs.isLoading ? (
            <div className="mt-4">
              <LoadingRows rows={2} />
            </div>
          ) : lastSuccess ? (
            <>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Last refreshed {formatDateTime(lastSuccess.finished_at ?? lastSuccess.started_at)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <MiniStat label="Event rows" value={lastSuccess.events_read} />
                <MiniStat label="Events saved" value={lastSuccess.events_upserted} />
                <MiniStat label="Attendee rows" value={lastSuccess.attendees_read} />
                <MiniStat label="People saved" value={lastSuccess.people_upserted} />
                <MiniStat label="Registrations" value={lastSuccess.bookings_upserted} />
                <MiniStat label="Skipped rows" value={lastSuccess.skipped_rows} />
              </div>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">
              No successful sync yet. Use Sync now to import the two source tabs.
            </p>
          )}
          {lastResult ? (
            <p className="mt-4 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-foreground">
              {lastResult}
            </p>
          ) : null}
          {sync.error ? (
            <div className="mt-4">
              <ErrorState message={(sync.error as Error).message} />
            </div>
          ) : null}
        </section>

        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Sync history</h2>
          <div className="mt-4 overflow-x-auto">
            {runs.isLoading ? (
              <LoadingRows rows={3} />
            ) : (runs.data ?? []).length === 0 ? (
              <EmptyState title="No sync runs recorded yet" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {["Started", "Status", "Events", "Attendees", "Registrations", "Message"].map(
                      (label) => (
                        <th
                          key={label}
                          className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.data!.map((run) => (
                    <tr key={run.id}>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {formatDateTime(run.started_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <SoftBadge
                          tone={
                            run.status === "success"
                              ? "success"
                              : run.status === "failed"
                                ? "danger"
                                : "info"
                          }
                        >
                          {run.status}
                        </SoftBadge>
                      </td>
                      <td className="px-3 py-2.5">
                        {run.events_upserted}/{run.events_read}
                      </td>
                      <td className="px-3 py-2.5">
                        {run.people_upserted}/{run.attendees_read}
                      </td>
                      <td className="px-3 py-2.5">{run.bookings_upserted}</td>
                      <td className="max-w-[22rem] px-3 py-2.5 text-xs text-muted-foreground">
                        {run.error_message ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Column mapping</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Headers are matched flexibly, ignoring case and punctuation. Anything unmapped is kept in
            the raw payload for traceability.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(mappings.data ?? []).map((row: any) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-sm"
              >
                <span className="truncate text-foreground">{row.source_header}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {row.target_field}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
