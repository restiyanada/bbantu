import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";

type Mode = "password" | "reset";
type Status = "idle" | "loading" | "resetSent" | "error";

// supabase-js gives no way to cancel signInWithPassword/resetPasswordForEmail,
// and a stalled connection (seen on mobile — a slow or dropped mobile-data
// handoff mid-request) can otherwise leave "Signing in…" spinning forever
// with no way for the visitor to know something's wrong or to retry. This
// doesn't cancel the underlying request — it just stops waiting on it and
// lets the visitor try again; if the original call does complete later,
// AdminAuthProvider's onAuthStateChange still picks it up normally.
const AUTH_TIMEOUT_MS = 15000;

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError()), ms)),
  ]);
}

export default function AdminLoginPage() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    try {
      const { error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        AUTH_TIMEOUT_MS
      );

      if (signInError) {
        setStatus("error");
        setError("Incorrect email or password.");
        return;
      }
      // onAuthStateChange (AdminAuthProvider) picks up the new session and
      // RequireAdmin will redirect once the profile loads — nothing else to do.
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof TimeoutError
          ? "This is taking too long — check your connection and try again."
          : "Something went wrong. Please try again."
      );
    }
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    try {
      const { error: resetError } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + "/admin/accept-invite",
        }),
        AUTH_TIMEOUT_MS
      );

      if (resetError) {
        setStatus("error");
        setError("Couldn't send the reset link. Please try again.");
        return;
      }
      setStatus("resetSent");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof TimeoutError
          ? "This is taking too long — check your connection and try again."
          : "Something went wrong. Please try again."
      );
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Staff login</CardTitle>
          <CardDescription>
            {mode === "password" ? "Sign in with your work email and password." : "We'll email you a reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "resetSent" ? (
            <p className="text-sm text-muted-foreground">
              Check <span className="font-medium text-foreground">{email}</span> for a link to set a new password.
              You can close this tab.
            </p>
          ) : mode === "password" ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  Work email
                  <RequiredMark />
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  Password
                  <RequiredMark />
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={status === "loading"}>
                {status === "loading" ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => {
                  setMode("reset");
                  setStatus("idle");
                  setError(null);
                }}
              >
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetRequest} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email">
                  Work email
                  <RequiredMark />
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={status === "loading"}>
                {status === "loading" ? "Sending…" : "Send reset link"}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => {
                  setMode("password");
                  setStatus("idle");
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
