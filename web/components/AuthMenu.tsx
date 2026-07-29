"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import type { UserRole } from "@/lib/types";
import { T, useToast } from "./Toast";

function initials(name: string | null, email: string): string {
  const base = (name || email || "?").trim();
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}

function AddUserDialog({ onClose }: { onClose: () => void }) {
  const { learn } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("creator");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await api.createUser({
        email: email.trim().toLowerCase(),
        password,
        display_name: displayName.trim() || undefined,
        role,
      });
      learn([T.strong("Account created."), T.text(`${u.email} can now sign in as ${u.role}.`)]);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("That email is already registered.");
      else if (err instanceof ApiError && err.status === 400)
        setError("Enter a valid email and a password of at least 8 characters.");
      else setError("Couldn't create the account.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-title">Add team member</h2>
        <p className="modal-sub">Provision an account for a creator, reviewer, or admin.</p>
        <label className="auth-field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="auth-field">
          <span>Display name (optional)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="auth-field">
          <span>Temporary password (8+ characters)</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="creator">Creator — upload &amp; translate</option>
            <option value="reader">Reader — read-only</option>
            <option value="admin">Admin — full access</option>
          </select>
        </label>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary sm" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AuthMenu() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  if (loading) return <div className="who" aria-hidden />;

  if (!user) {
    const next = encodeURIComponent(pathname || "/");
    return (
      <Link className="btn btn-primary sm" href={`/login?next=${next}`}>
        Sign in
      </Link>
    );
  }

  return (
    <div className="authmenu">
      <button
        className="authmenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.email}
      >
        <span className="avatar">{initials(user.display_name, user.email)}</span>
      </button>
      {open && (
        <>
          <div className="authmenu-backdrop" onClick={() => setOpen(false)} />
          <div className="authmenu-pop" role="menu">
            <div className="authmenu-id">
              <b>{user.display_name || user.email}</b>
              <span className="authmenu-role">{user.role}</span>
            </div>
            {user.display_name && <div className="authmenu-email">{user.email}</div>}
            {isAdmin(user) && (
              <button
                className="authmenu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setAdding(true);
                }}
              >
                Add team member…
              </button>
            )}
            <button
              className="authmenu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
      {adding && <AddUserDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
