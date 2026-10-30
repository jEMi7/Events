import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SupabaseCtx = { supabase: any; userId: string };

async function assertAdmin(ctx: SupabaseCtx) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  const isAdmin = (data ?? []).some((row: { role: string }) => row.role === "admin");
  if (!isAdmin) throw new Error("Only administrators can manage the data source.");
}

export const getSourceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as SupabaseCtx;
    const { sourceConnected } = await import("./sheets.server");
    const { loadSourceConfig } = await import("./sync-core.server");
    const source = await loadSourceConfig(ctx.supabase);
    return { connected: sourceConnected(), source };
  });

/** Manual "Sync now" for administrators. Shares one implementation with the
 * scheduled 15-minute sync. */
export const runSourceSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as SupabaseCtx;
    await assertAdmin(ctx);
    const { performSync } = await import("./sync-core.server");
    return performSync(ctx.supabase, ctx.userId);
  });
