"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, verifyAccessToken } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icon";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "recovery">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage("El inicio de sesión no está configurado en esta instalación. Agrega las variables de Supabase al archivo local .env.");
      return;
    }

    setBusy(true);
    if (mode === "recovery") {
      let recoveryError: Error | null = null;
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/accept-invite`,
        });
        recoveryError = error;
      } catch {
        recoveryError = new Error("No se pudo enviar el enlace.");
      }
      setBusy(false);
      if (recoveryError) setMessage("No se pudo enviar el enlace. Verifica el correo e inténtalo de nuevo.");
      else setSuccess("Si el correo corresponde a una cuenta, recibirás un enlace para restablecer la contraseña.");
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session?.access_token) {
        setMessage("No se pudo iniciar sesión. Verifica el correo y la contraseña.");
        setBusy(false);
        return;
      }
      try {
        await verifyAccessToken(data.session.access_token);
      } catch (accessError) {
        await supabase.auth.signOut();
        if (accessError instanceof ApiError && accessError.status === 403) {
          setMessage("La cuenta inició sesión, pero no tiene un perfil activo asignado al portal. Contacta a Administración.");
        } else if (accessError instanceof ApiError && accessError.status === 0) {
          setMessage("No se pudo conectar con el backend para validar el acceso. Revisa que el servicio esté disponible.");
        } else {
          setMessage("No se pudo validar el acceso. Inténtalo nuevamente.");
        }
        setBusy(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setMessage("Ocurrió un problema al iniciar sesión. Inténtalo nuevamente.");
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <Link className="login-brand" href="/">
          <span className="brand-mark"><Icon name="factory" size={22} /></span>
          <span className="brand-copy"><strong>Carrocerías Aguirre</strong><span>Portal de operación</span></span>
        </Link>
        <div className="login-story">
          <p className="page-eyebrow">Sistema interno</p>
          <h1>El trabajo del taller, en un solo lugar.</h1>
          <p>Un espacio de trabajo para dar seguimiento a clientes, unidades, servicios y fabricación.</p>
          <div aria-hidden="true" className="login-decoration"><i /><i /><i /></div>
        </div>
        <span className="login-foot">Acceso exclusivo para personal autorizado</span>
      </section>

      <section className="login-form-side">
        <div className="login-card">
          <p className="page-eyebrow">Acceso seguro</p>
          <h2>{mode === "recovery" ? "Recuperar acceso" : "Iniciar sesión"}</h2>
          <p className="login-subtitle">{mode === "recovery" ? "Te enviaremos un enlace seguro para cambiar tu contraseña." : "Ingresa con las credenciales de tu cuenta del portal."}</p>

          {message && <p className="login-alert" role="alert">{message}</p>}
          {success && <p className="login-success" role="status">{success}</p>}

          <form onSubmit={handleSubmit}>
            <div className="login-form-group">
              <label className="field-label" htmlFor="email">Correo electrónico</label>
              <input autoComplete="email" className="login-field" id="email" onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" required type="email" value={email} />
            </div>
            {mode === "login" && <>
              <div className="login-form-group">
                <label className="field-label" htmlFor="password">Contraseña</label>
                <input autoComplete="current-password" className="login-field" id="password" onChange={(event) => setPassword(event.target.value)} placeholder="Ingresa tu contraseña" required type="password" value={password} />
              </div>
              <div className="login-meta"><button className="text-link" onClick={() => { setMode("recovery"); setMessage(""); setSuccess(""); }} type="button">¿Olvidaste tu contraseña?</button></div>
            </>}
            <button className="login-submit" disabled={busy} type="submit">{busy ? "Procesando…" : mode === "recovery" ? "Enviar enlace de recuperación" : "Entrar al portal"}</button>
          </form>
          {mode === "recovery" && <div style={{ marginTop: 15, textAlign: "center" }}><button className="text-link" onClick={() => { setMode("login"); setMessage(""); setSuccess(""); }} type="button">Volver al inicio de sesión</button></div>}
          <div className="login-bottom">El acceso requiere una cuenta activa y un perfil autorizado.<br />Si necesitas ayuda, contacta a Administración.</div>
        </div>
      </section>
    </main>
  );
}
