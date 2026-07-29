"use client";

// Auth context — the single source of truth for "who is logged in" on the client.
// On mount it asks the backend (GET /api/auth/me via the cookie) so a refresh or
// a fresh tab restores the session. Everything auth-aware reads useAuth().

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  loading: boolean; // true until the first /me resolves
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Monotonic token guarding against a slow /me overwriting a newer auth state.
  // login()/logout() bump it so any in-flight me() result is discarded; a me()
  // only applies if it's still the latest request.
  const seq = useRef(0);

  const runMe = useCallback(async () => {
    const mine = ++seq.current;
    const u = await api.me().catch(() => null);
    if (mine === seq.current) setUser(u);
    return u;
  }, []);

  const refresh = useCallback(async () => {
    await runMe();
  }, [runMe]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await runMe();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [runMe]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password);
    seq.current++; // invalidate any in-flight me() so it can't clobber this
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    seq.current++; // stop the UI trusting the old session while logout is in flight
    await api.logout().catch(() => undefined);
    seq.current++; // discard any me()/refresh() that started during the await…
    setUser(null); // …so this null can't be overwritten back to the old user
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

// Convenience predicates shared by the UI (upload, delete, admin-only screens).
export function canWrite(user: User | null): boolean {
  return !!user && user.role !== "reader";
}
export function isAdmin(user: User | null): boolean {
  return user?.role === "admin";
}
