import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "staff";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setSession(next);
      if (event === "SIGNED_OUT") queryClient.clear();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  return { session, ready, user: session?.user ?? null };
}

/** Ensures a staff profile exists and returns the signed-in user's role. */
export function useCurrentStaff() {
  const { user, ready } = useSession();

  const query = useQuery({
    queryKey: ["current-staff", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { error: rpcError } = await supabase.rpc("ensure_profile", {
        _full_name: (user?.user_metadata?.["full_name"] as string | undefined) ?? "",
      });
      if (rpcError) throw rpcError;

      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").eq("id", user!.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
      ]);

      const roleList = (roles ?? []).map((r) => r.role as AppRole);
      return {
        id: user!.id,
        email: profile?.email ?? user!.email ?? "",
        fullName: profile?.full_name ?? user!.email ?? "Staff member",
        roles: roleList,
        isAdmin: roleList.includes("admin"),
      };
    },
  });

  return { ...query, ready, user };
}
