"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: string | null;
}

interface UserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

const PUBLIC_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: CurrentUser }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Don't bother hitting /me on the auth pages — we know we're logged out there.
    if (PUBLIC_PATHS.has(pathname)) {
      setUser(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [pathname, refresh]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <UserContext.Provider value={{ user, loading, logout, refresh }}>
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useCurrentUser must be used inside <UserProvider>");
  return ctx;
}
