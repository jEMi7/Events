import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  MailCheck,
  PhoneCall,
  Settings,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SoftBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStaff } from "@/hooks/use-auth";
import { initials } from "@/lib/domain";
import { cn } from "@/lib/utils";
import "@/styles/workspace-sidebar.css";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/people", label: "People", icon: Users },
  { to: "/callbacks", label: "Call backs", icon: PhoneCall },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin", label: "Admin", icon: Settings, adminOnly: true },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const staff = useCurrentStaff();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isDashboard = pathname === "/dashboard" || pathname === "/dashboard/";
  const isEvents = pathname === "/events" || pathname === "/events/";
  const isAdmin = staff.data?.isAdmin ?? false;
  const items = NAV.filter((item) => !("adminOnly" in item && item.adminOnly) || isAdmin);

  const nav = (
    <nav className="workspace-nav flex flex-col gap-1" aria-label="Main navigation">
      {items.map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-lav-100 text-secondary-foreground lav-ring"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div
      className={cn(
        "workspace-shell min-h-screen bg-background",
        isDashboard && "dashboard-shell",
        isEvents && "events-shell",
      )}
    >
      <aside className="workspace-sidebar fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
        <Link to="/dashboard" className="workspace-college-logo focus-ring">
          <img
            src="/images/kent-business-college-logo-sidebar.png"
            alt="Kent Business College"
            width={195}
            height={98}
          />
        </Link>
        <Link to="/dashboard" className="focus-ring rounded-xl px-1 py-1">
          <span className="workspace-wordmark">
            <span className="workspace-hub-mark">
              <MailCheck aria-hidden="true" />
            </span>
            <span>
              <strong>Event Registrations Hub</strong>
              <small>Confirmation operations</small>
            </span>
          </span>
        </Link>
        <div className="workspace-nav-area mt-7 flex-1">
          {nav}
          <p className="workspace-sidebar-motto" aria-hidden="true">
            A Brighter
            <br />
            Future Together
          </p>
        </div>
        <div className="workspace-profile rounded-xl border border-sidebar-border bg-card p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-lav-100 text-xs font-semibold text-secondary-foreground">
              {initials(staff.data?.fullName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {staff.data?.fullName ?? "Staff"}
              </p>
              <p className="truncate text-xs text-muted-foreground">{staff.data?.email}</p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <SoftBadge tone={isAdmin ? "lavender" : "neutral"}>
              {isAdmin ? "Admin" : "Staff"}
            </SoftBadge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => supabase.auth.signOut()}
              aria-label="Sign out"
            >
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </div>
      </aside>

      <header className="workspace-mobilebar sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/dashboard" className="focus-ring rounded-lg">
          <img
            src="/images/kent-business-college-logo-sidebar.png"
            alt="Kent Business College"
            className="w-28"
          />
        </Link>
        <Button
          variant="outline"
          size="icon"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="workspace-mobile-navigation"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
      </header>

      {mobileOpen ? (
        <div
          id="workspace-mobile-navigation"
          className="workspace-mobilemenu fixed inset-x-0 top-[61px] z-30 border-b border-border bg-background p-4 shadow-pop lg:hidden"
        >
          {nav}
          <Button variant="outline" className="mt-3 w-full" onClick={() => supabase.auth.signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      ) : null}

      <main className="workspace-main lg:pl-64">
        <div className="workspace-content mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
