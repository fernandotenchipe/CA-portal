"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, verifyAccessToken, type AuthProfile } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "authenticated"; profile: AuthProfile }
  | { status: "error"; message: string; code: number };

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<AuthProfile | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setState({ status: "error", code: -1, message: "Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para iniciar." });
      return null;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setState({ status: "error", code: 0, message: "No se pudo recuperar la sesión de Supabase." });
      return null;
    }
    if (!data.session?.access_token) {
      setState({ status: "signed-out" });
      return null;
    }

    try {
      const profile = await verifyAccessToken(data.session.access_token);
      setState({ status: "authenticated", profile });
      return profile;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("No se pudo validar la sesión.", 0);
      setState({ status: "error", code: apiError.status, message: apiError.message });
      if (apiError.status === 401 || apiError.status === 403) await supabase.auth.signOut();
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseBrowserClient()?.auth.signOut();
    setState({ status: "signed-out" });
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refresh(); }, 0);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return () => window.clearTimeout(initialRefresh);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setState({ status: "signed-out" });
      else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        window.setTimeout(() => { void refresh(); }, 0);
      }
    });
    return () => {
      window.clearTimeout(initialRefresh);
      subscription.unsubscribe();
    };
  }, [refresh]);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePortalAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("usePortalAuth debe usarse dentro de PortalAuthProvider.");
  return value;
}
