import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Constant-time comparison of the caller's bearer token with the shared secret. */
async function authoriseScheduledCall(request: Request): Promise<Response | null> {
  const expected = process.env["SHEETS_SYNC_CRON_SECRET"];
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];

  if (expected && token) {
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
    if (timingSafeEqual(digest(token), digest(expected))) return null;
  }

  // Fall back to the platform cron secret so either scheduler can call this.
  return authenticateCronRequest(request);
}

/**
 * Scheduled Google Sheets import. Called every 15 minutes by the database
 * scheduler; requires the shared secret. Runs the exact same sync as the
 * admin "Sync now" button.
 */
export const Route = createFileRoute("/api/public/hooks/sync-sheets")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorised = await authoriseScheduledCall(request);
        if (unauthorised) return unauthorised;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { performSync } = await import("@/lib/sync-core.server");
          const result = await performSync(supabaseAdmin, null);
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown sync error";
          console.error("[cron sync] failed", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
