"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  parseAuthCallback,
  validateAuthCallbackSession,
  type PasswordLinkType,
} from "./auth-callback";

type ViewState = "checking" | "ready" | "saving" | "complete" | "error";

function clearCallbackUrl() {
  window.history.replaceState(window.history.state, "", window.location.pathname);
}

function errorMessage(status: "expired" | "invalid" | "no-session" | "configuration") {
  switch (status) {
    case "expired":
      return "Este enlace venció. Solicita un enlace nuevo para continuar.";
    case "no-session":
      return "No se recibió una sesión válida. Abre el enlace completo del correo o solicita uno nuevo.";
    case "configuration":
      return "Falta configurar la conexión de Supabase en el frontend.";
    default:
      return "El enlace no es válido o ya fue utilizado. Solicita un enlace nuevo.";
  }
}

export default function AcceptInvitePage() {
  const [state, setState] = useState<ViewState>("checking");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [linkType, setLinkType] = useState<PasswordLinkType | null>(null);
  const callbackProcessing = useRef(false);

  useEffect(() => {
    if (callbackProcessing.current) return;
    callbackProcessing.current = true;

    async function verifyInvite() {
      const callback = parseAuthCallback(window.location.href);

      // Remove callback credentials before making network requests or rendering UI.
      clearCallbackUrl();
      if (callback.type) setLinkType(callback.type);

      if (callback.status !== "session" && callback.status !== "code") {
        setMessage(errorMessage(callback.status));
        setState("error");
        return;
      }

      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!projectUrl || !publishableKey) {
        setMessage(errorMessage("configuration"));
        setState("error");
        return;
      }

      try {
        const client = createClient(projectUrl, publishableKey, {
          auth: {
            detectSessionInUrl: false,
            flowType: callback.status === "code" ? "pkce" : "implicit",
            persistSession: true,
            autoRefreshToken: true,
          },
        });
        const validSession = await validateAuthCallbackSession(client, callback);
        if (!validSession) throw new Error("Invalid or expired auth session");

        setSupabase(client);
        setLinkType(callback.type);
        setState("ready");
      } catch {
        setMessage(errorMessage("invalid"));
        setState("error");
      }
    }

    void verifyInvite();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    if (password.length < 8) {
      setMessage("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    setMessage("");
    setState("saving");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    } catch {
      setPassword("");
      setConfirmPassword("");
      setMessage("No se pudo guardar la contraseña. Verifica los requisitos e inténtalo de nuevo.");
      setState("ready");
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setState("complete");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Carrocerías Aguirre
        </p>
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">
          {linkType === "recovery"
            ? "Restablecer contraseña"
            : linkType === "invite"
              ? "Aceptar invitación"
              : state === "checking"
                ? "Validando enlace"
                : "Verificar enlace"}
        </h1>

        {state === "checking" && <p role="status">Validando invitación…</p>}

        {state === "ready" || state === "saving" ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <p className="text-sm text-slate-600">
              {linkType === "recovery"
                ? "Establece una contraseña nueva para tu cuenta."
                : "Establece una contraseña para completar la activación de tu cuenta."}
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="password">Nueva contraseña</label>
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                id="password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="confirm-password">Confirmar contraseña</label>
              <input
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                id="confirm-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </div>
            {message && <p className="text-sm text-red-700" role="alert">{message}</p>}
            <button
              className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60"
              disabled={state === "saving"}
              type="submit"
            >
              {state === "saving" ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        ) : null}

        {state === "complete" && (
          <p className="text-sm text-green-800" role="status">
            {linkType === "recovery"
              ? "Tu contraseña fue restablecida correctamente."
              : "Tu contraseña quedó configurada. La invitación fue aceptada."}
          </p>
        )}

        {state === "error" && <p className="text-sm text-red-700" role="alert">{message}</p>}
      </section>
    </main>
  );
}
