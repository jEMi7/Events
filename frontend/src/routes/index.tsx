import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  CalendarCheck,
  UsersRound,
  ChartNoAxesColumnIncreasing,
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useSession } from "@/hooks/use-auth";
import "@/styles/welcome.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Event Attendance Hub — Confirmation operations for event teams" },
      {
        name: "description",
        content:
          "A secure operations hub for calling registrants, recording confirmations, scheduling call backs and tracking real attendance.",
      },
      {
        property: "og:title",
        content: "Event Attendance Hub — Confirmation operations for event teams",
      },
      {
        property: "og:description",
        content:
          "Call registrants, record outcomes, schedule call backs and track who actually attended.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const showRecovery = useCallback(() => {}, []);
  return (
    <main className="welcome-page">
      <img
        className="welcome-campus"
        src="/images/login-campus-background.png"
        alt=""
        fetchPriority="high"
      />
      <div className="welcome-atmosphere" aria-hidden="true" />
      <header className="welcome-logo">
        <img
          src="/images/kent-business-college-logo-sidebar.png"
          alt="Kent Business College"
          width={438}
          height={201}
        />
      </header>
      <section className="welcome-copy" aria-labelledby="welcome-heading">
        <WelcomeCard />
      </section>
      <section className="welcome-login" aria-label="Sign in or create an account">
        <AuthenticationCard onRecovery={showRecovery} />
      </section>
    </main>
  );
}

function WelcomeCard() {
  return (
    <>
      <p className="welcome-eyebrow">Event Registrations Hub</p>
      <h1 id="welcome-heading">
        Welcome <span>back</span>
      </h1>
      <p className="unified-home-intro">
        Sign in to manage your events, attendees and confirmations – all in one place.
      </p>
      <div className="unified-home-features">
        <div className="unified-home-feature">
          <span className="unified-home-feature-icon">
            <CalendarCheck aria-hidden="true" />
          </span>
          <div>
            <h2>Manage events</h2>
            <p>Create and organise your event registrations with ease.</p>
          </div>
        </div>
        <div className="unified-home-feature">
          <span className="unified-home-feature-icon">
            <UsersRound aria-hidden="true" />
          </span>
          <div>
            <h2>Track attendees</h2>
            <p>See who’s registered, what’s confirmed, and more.</p>
          </div>
        </div>
        <div className="unified-home-feature">
          <span className="unified-home-feature-icon">
            <ChartNoAxesColumnIncreasing aria-hidden="true" />
          </span>
          <div>
            <h2>Stay organised</h2>
            <p>Keep your team aligned with real-time registration data.</p>
          </div>
        </div>
      </div>
      <p className="welcome-slogan">
        A Brighter
        <br />
        Future Together
        <span aria-hidden="true" />
      </p>
    </>
  );
}

function AuthenticationCard({ onRecovery }: { onRecovery: () => void }) {
  const navigate = useNavigate();
  const { session, ready } = useSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState<"request" | "password" | null>(null);
  const recovering = useRef(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recovering.current = true;
        setRecovery("password");
        onRecovery();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [onRecovery]);

  useEffect(() => {
    if (!ready || !session || recovering.current) return;
    let active = true;
    // Validate cached sessions before redirecting, just as the protected route does.
    // A stale session must not bounce between the homepage and dashboard.
    supabase.auth.getUser().then(({ data, error }) => {
      if (active && !error && data.user && !recovering.current)
        navigate({ to: "/dashboard", replace: true });
    });
    return () => {
      active = false;
    };
  }, [ready, session, navigate]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else navigate({ to: "/dashboard", replace: true });
  };

  const signUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Account created. Check your inbox if confirmation is required.");
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in is unavailable right now.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard", replace: true });
  };

  const recoverPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (recovery === "request") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        toast.success("Check your inbox for a password reset link.");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated.");
        recovering.current = false;
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reset your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="unified-home-auth">
      <img
        className="welcome-card-logo"
        src="/images/kent-business-college-logo-sidebar.png"
        alt="Kent Business College"
        width={438}
        height={201}
      />
      {!recovery && (
        <div className="welcome-card-heading">
          <h2>{mode === "signin" ? "Sign in to your account" : "Create your account"}</h2>
          <p>Access your event registrations hub</p>
        </div>
      )}
      {recovery ? (
        <form className="unified-home-recovery" onSubmit={recoverPassword}>
          <h2>{recovery === "request" ? "Reset your password" : "Choose a new password"}</h2>
          <p>
            {recovery === "request"
              ? "Enter your work email and we’ll send you a reset link."
              : "Enter a new password with at least 8 characters."}
          </p>
          <div>
            <Label htmlFor="recovery-field">
              {recovery === "request" ? "Work email" : "New password"}
            </Label>
            <Input
              id="recovery-field"
              type={recovery === "request" ? "email" : "password"}
              autoComplete={recovery === "request" ? "email" : "new-password"}
              required
              minLength={recovery === "password" ? 8 : undefined}
              value={recovery === "request" ? email : password}
              onChange={(event) =>
                recovery === "request"
                  ? setEmail(event.target.value)
                  : setPassword(event.target.value)
              }
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : recovery === "request" ? "Send reset link" : "Update password"}
          </Button>
          {recovery === "request" && (
            <button
              type="button"
              className="unified-home-text-button"
              onClick={() => setRecovery(null)}
            >
              Back to sign in
            </button>
          )}
        </form>
      ) : (
        <>
          {mode === "signin" ? (
            <div className="welcome-auth-form">
              <form className="space-y-4" onSubmit={signIn}>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email">Work email</Label>
                  <div className="unified-home-input-wrap">
                    <Mail aria-hidden="true" className="unified-home-input-icon" />
                    <Input
                      id="signin-email"
                      placeholder="name@yourorganisation.co.uk"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-password">Password</Label>
                  <div className="unified-home-input-wrap">
                    <LockKeyhole aria-hidden="true" className="unified-home-input-icon" />
                    <Input
                      id="signin-password"
                      placeholder="Enter your password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      className="unified-home-password-toggle"
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <div className="unified-home-auth-options">
                  <button
                    type="button"
                    className="unified-home-text-button"
                    onClick={() => setRecovery("request")}
                  >
                    Forgot password?
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? (
                    "Signing in…"
                  ) : (
                    <>
                      Sign in <ArrowRight aria-hidden="true" className="size-4" />
                    </>
                  )}
                </Button>
              </form>
            </div>
          ) : (
            <div className="welcome-auth-form">
              <form className="space-y-4" onSubmit={signUp}>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-name">Full name</Label>
                  <Input
                    id="signup-name"
                    autoComplete="name"
                    placeholder="Your full name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Work email</Label>
                  <Input
                    id="signup-email"
                    placeholder="name@yourorganisation.co.uk"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    placeholder="At least 8 characters"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  The first account created becomes the administrator. Later accounts join as staff.
                </p>
              </form>
            </div>
          )}
          <div className="unified-home-divider">
            <span />
            OR CONTINUE WITH
            <span />
          </div>
          <Button
            variant="outline"
            className="unified-home-google w-full"
            onClick={google}
            disabled={busy}
          >
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 48 48">
              <path
                fill="#4285F4"
                d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4.1 6v5h6.6c3.9-3.6 6.1-8.8 6.1-14.7Z"
              />
              <path
                fill="#34A853"
                d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2C9.2 39.5 16 44 24 44Z"
              />
              <path
                fill="#FBBC05"
                d="M12.6 27.7a12 12 0 0 1 0-7.4v-5.2H5.8a20 20 0 0 0 0 17.8l6.8-5.2Z"
              />
              <path
                fill="#EA4335"
                d="M24 11.9c3 0 5.6 1 7.7 3l5.7-5.7C34 6 29.4 4 24 4 16 4 9.2 8.5 5.8 15.1l6.8 5.2c1.6-4.8 6.1-8.4 11.4-8.4Z"
              />
            </svg>
            Continue with Google
          </Button>
          <p className="welcome-account-link">
            {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="unified-home-text-button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create account" : "Sign in"}
            </button>
          </p>
        </>
      )}
    </div>
  );
}
