"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

// Resolve the post-login target to a SAME-ORIGIN path only. Parsing with the
// URL API (rather than string checks) neutralizes every open-redirect trick —
// "//evil", "/\evil" (%2F%5C), and control-char splits like "/\t/evil"
// (%2F%09%2F), which the URL spec strips before the host is parsed. Anything
// that resolves off-origin falls back to "/".
function safeNext(raw: string): string {
  if (typeof window === "undefined") return "/";
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
  } catch {
    /* malformed → home */
  }
  return "/";
}

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace(safeNext(rawNext));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect email or password.");
      } else {
        setError("Couldn't sign in. Is the server running?");
      }
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <BrandMark />
          <b>Miʿrāj</b>
        </div>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">Translation workbench for the Haydari corpus.</p>

        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@haydari.local"
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="auth-foot">
          Reading only? <a href="/">Browse the published library →</a>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<main className="auth-wrap" />}>
      <LoginForm />
    </Suspense>
  );
}
