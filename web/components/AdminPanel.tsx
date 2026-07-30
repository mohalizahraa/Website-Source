"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AdminSettings, AdminUser, UsageOverview } from "@/lib/types";
import { T, useToast } from "./Toast";

// Parsers return {ok:false} for malformed input so the caller can REJECT it
// rather than silently coercing to null (which would clear an admin's override).
type Parsed<T> = { ok: true; value: T } | { ok: false };

// A cap field: blank → null (use server default); off/none/unlimited → "off"
// (no cap); a finite non-negative number → that cap; anything else → invalid.
function parseCap(s: string): Parsed<number | null | "off"> {
  const t = s.trim().toLowerCase();
  if (t === "") return { ok: true, value: null };
  if (["off", "none", "unlimited", "∞", "no limit"].includes(t)) return { ok: true, value: "off" };
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}
// Per-run page limit: blank → null (use server default); else a positive integer.
function parsePages(s: string): Parsed<number | null> {
  const t = s.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 ? { ok: true, value: n } : { ok: false };
}
function fmtUsd(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

type UserDraft = { role: AdminUser["role"]; limit: string };

export function AdminPanel({
  onClose,
  onAddUser,
}: {
  onClose: () => void;
  onAddUser: () => void;
}) {
  const { learn } = useToast();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Editable form state (strings so inputs can be cleared).
  const [globalCap, setGlobalCap] = useState("");
  const [userDefault, setUserDefault] = useState("");
  const [maxPages, setMaxPages] = useState("");
  const [savingCfg, setSavingCfg] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, u, list] = await Promise.all([
          api.getSettings(),
          api.usageOverview(),
          api.listUsers(),
        ]);
        if (!alive) return;
        setSettings(s);
        setUsage(u);
        setUsers(list);
        setUserDrafts(
          Object.fromEntries(
            list.map((member) => [
              member.id,
              {
                role: member.role,
                limit: member.monthly_usd_limit == null ? "" : String(member.monthly_usd_limit),
              },
            ]),
          ),
        );
        // A null cap means "no limit" — show it as "off" (blank would read as
        // "use the default" and silently re-enable a cap on the next save).
        setGlobalCap(s.global_monthly_usd == null ? "off" : String(s.global_monthly_usd));
        setUserDefault(s.user_monthly_usd_default == null ? "off" : String(s.user_monthly_usd_default));
        setMaxPages(String(s.max_pages_per_run));
      } catch (e) {
        if (alive) setErr("Couldn't load admin settings.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const saveConfig = async () => {
    const g = parseCap(globalCap);
    const d = parseCap(userDefault);
    const p = parsePages(maxPages);
    if (!g.ok || !d.ok || !p.ok) {
      learn([
        T.strong("Check the values."),
        T.text("Caps must be a number, blank (server default), or “off”. Max pages must be a whole number ≥ 1."),
      ]);
      return;
    }
    setSavingCfg(true);
    try {
      const s = await api.updateSettings({
        global_monthly_usd: g.value,
        user_monthly_usd_default: d.value,
        max_pages_per_run: p.value ?? undefined,
      });
      setSettings(s);
      learn([T.strong("Settings saved."), T.text("New limits take effect immediately.")]);
    } catch (e) {
      learn([T.strong("Couldn't save settings."), T.text(String(e))]);
    } finally {
      setSavingCfg(false);
    }
  };

  const saveUser = async (u: AdminUser) => {
    const draft = userDrafts[u.id] ?? {
      role: u.role,
      limit: u.monthly_usd_limit == null ? "" : String(u.monthly_usd_limit),
    };
    const t = draft.limit.trim();
    const value = draft.role === "admin" || t === "" ? null : Number(t);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      learn([T.strong("Invalid limit."), T.text("Enter a non-negative number, or leave blank for the default.")]);
      return;
    }
    setSavingUser(u.id);
    try {
      const updated = await api.updateUser(u.id, {
        monthly_usd_limit: value,
        role: draft.role,
      });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...updated } : x)));
      setUserDrafts((prev) => ({
        ...prev,
        [u.id]: {
          role: updated.role,
          limit: updated.monthly_usd_limit == null ? "" : String(updated.monthly_usd_limit),
        },
      }));
      learn([
        T.strong("Team member updated."),
        T.text(`${u.email}: ${updated.role}, cap ${fmtUsd(updated.monthly_usd_limit)}.`),
      ]);
    } catch (e) {
      learn([T.strong("Couldn't update team member."), T.text(String(e))]);
    } finally {
      setSavingUser(null);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card admin-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Admin settings</h2>
        <p className="modal-sub">Spend caps and the per-run page limit. Changes apply immediately.</p>

        {err && <div className="auth-error">{err}</div>}

        {settings && (
          <>
            <div className="admin-grid">
              <label className="auth-field">
                <span>Global monthly cap (USD)</span>
                <input
                  inputMode="decimal"
                  value={globalCap}
                  placeholder={`env: ${fmtUsd(settings.defaults.global_monthly_usd)}`}
                  onChange={(e) => setGlobalCap(e.target.value)}
                />
              </label>
              <label className="auth-field">
                <span>Default per-user cap (USD)</span>
                <input
                  inputMode="decimal"
                  value={userDefault}
                  placeholder={`env: ${fmtUsd(settings.defaults.user_monthly_usd_default)}`}
                  onChange={(e) => setUserDefault(e.target.value)}
                />
              </label>
              <label className="auth-field">
                <span>Max pages per ingest run</span>
                <input
                  inputMode="numeric"
                  value={maxPages}
                  placeholder={`env: ${settings.defaults.max_pages_per_run}`}
                  onChange={(e) => setMaxPages(e.target.value)}
                />
              </label>
            </div>
            <p className="admin-hint">
              For a cap: enter a number, leave blank to use the server default, or type{" "}
              <b>off</b> for no limit. The per-run page limit is the main token-budget guard — each
              ingest run never processes more than this many pages.
            </p>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-primary sm" onClick={saveConfig} disabled={savingCfg}>
                {savingCfg ? "Saving…" : "Save settings"}
              </button>
            </div>
          </>
        )}

        {usage && (
          <div className="admin-usage">
            This month ({usage.month}): <b>{fmtUsd(usage.global_spent_usd)}</b> spent
            {usage.global_limit_usd != null && <> of {fmtUsd(usage.global_limit_usd)}</>}.
          </div>
        )}

        <div className="admin-team-head">
          <div className="section-label">Team members &amp; limits</div>
          <button className="btn btn-primary sm" type="button" onClick={onAddUser}>
            Add team member
          </button>
        </div>
        <div className="admin-users">
          {users.map((u) => (
            <div className="admin-user-row" key={u.id}>
              <div className="au-id">
                <b>{u.display_name || u.email}</b>
              </div>
              <div className="au-spent">{fmtUsd(u.spent_usd)} used</div>
              <label className="au-role">
                <span>Role</span>
                <select
                  value={userDrafts[u.id]?.role ?? u.role}
                  onChange={(e) =>
                    setUserDrafts((prev) => ({
                      ...prev,
                      [u.id]: {
                        role: e.target.value as AdminUser["role"],
                        limit:
                          prev[u.id]?.limit ??
                          (u.monthly_usd_limit == null ? "" : String(u.monthly_usd_limit)),
                      },
                    }))
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="creator">Creator</option>
                  <option value="reader">Reader</option>
                </select>
              </label>
              <label className="au-limit">
                <span>Cap</span>
                <input
                  inputMode="decimal"
                  value={userDrafts[u.id]?.limit ?? ""}
                  placeholder={
                    (userDrafts[u.id]?.role ?? u.role) === "admin"
                      ? "global only"
                      : fmtUsd(settings?.user_monthly_usd_default)
                  }
                  disabled={(userDrafts[u.id]?.role ?? u.role) === "admin"}
                  onChange={(e) =>
                    setUserDrafts((prev) => ({
                      ...prev,
                      [u.id]: {
                        role: prev[u.id]?.role ?? u.role,
                        limit: e.target.value,
                      },
                    }))
                  }
                />
              </label>
              <button
                className="btn sm"
                type="button"
                disabled={savingUser === u.id}
                onClick={() => void saveUser(u)}
              >
                {savingUser === u.id ? "Saving…" : "Save"}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
