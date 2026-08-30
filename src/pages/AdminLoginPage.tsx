import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";

type Mode = "password" | "reset";
type Status = "idle" | "loading" | "resetSent" | "error";

// The Supabase client (src/lib/supabaseClient.ts) aborts its own underlying
// fetch after 15s, so signInWithPassword/resetPasswordForEmail resolve with
// an AuthRetryableFetchError rather than hanging — no client-side race
// needed here anymore. That's a deliberate switch from an earlier version
// of this file that raced against a plain setTimeout: mobile browsers can
// throttle or pause JS timers in a backgrounded/locked tab, so a page-level
// timer isn't reliable there, but aborting the actual request is.
function isNetworkError(err: { name?: string } | null | undefined): boolean {
  return err?.name === "AuthRetryableFetchError";
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

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (signInError) {
      setStatus("error");
      setError(
        isNetworkError(signInError)
          ? "This is taking too long — check your connection and try again."
          : "Incorrect email or password."
      );
      return;
    }
    // onAuthStateChange (AdminAuthProvider) picks up the new session and
    // RequireAdmin will redirect once the profile loads — nothing else to do.
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + "/admin/accept-invite",
    });

    if (resetError) {
      setStatus("error");
      setError(
        isNetworkError(resetError)
          ? "This is taking too long — check your connection and try again."
          : "Couldn't send the reset link. Please try again."
      );
      return;
    }
    setStatus("resetSent");
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
