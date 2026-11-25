"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { usePortalAuth } from "@/components/portal-auth";
import { Icon, type IconName } from "@/components/icon";

const navigation: { label: string; items: { href: string; label: string; icon: IconName }[] }[] = [
  { label: "General", items: [{ href: "/dashboard", label: "Panel principal", icon: "home" }] },
  { label: "Directorio", items: [{ href: "/clientes", label: "Clientes", icon: "users" }, { href: "/unidades", label: "Unidades", icon: "truck" }] },
  { label: "Operación", items: [{ href: "/hojas", label: "Hojas de trabajo", icon: "clipboard" }, { href: "/fabricacion", label: "Órdenes de fabricación", icon: "factory" }] },
  { label: "Sistema", items: [{ href: "/notificaciones", label: "Notificaciones", icon: "bell" }] },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("es-MX")).join("");
}

function LoadingScreen({ message = "Verificando acceso al portal…" }: { message?: string }) {
  return <main className="auth-loading"><div className="loading-card"><span className="spinner" /><span>{message}</span></div></main>;
}

function AccessGate({ children }: { children: ReactNode }) {
  const { state, refresh } = usePortalAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "signed-out") router.replace("/login");
  }, [state.status, router]);

  if (state.status === "loading" || state.status === "signed-out") return <LoadingScreen />;
  if (state.status === "error") {
    const authExpired = state.code === 401 || state.code === 403;
    return (
      <main className="auth-loading">
        <section className="denied-card">
          <span className="empty-icon"><Icon name={authExpired ? "shield" : "activity"} size={22} /></span>
          <h1>{authExpired ? "Acceso no disponible" : "No se pudo validar el acceso"}</h1>
          <p>{state.message}</p>
          {authExpired ? <Link className="button-primary" href="/login">Ir al inicio de sesión</Link> : <button className="button-primary" onClick={() => void refresh()}>Reintentar</button>}
        </section>
      </main>
    );
  }
  return children;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, signOut } = usePortalAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = state.status === "authenticated" ? state.profile : null;

  return (
    <AccessGate>
      <div className="app-frame">
        {mobileOpen && <button aria-label="Cerrar menú" className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
        <aside className={`sidebar${mobileOpen ? " open" : ""}`}>
          <Link className="sidebar-brand" href="/dashboard">
            <span className="brand-mark"><Icon name="factory" size={21} strokeWidth={1.8} /></span>
            <span className="brand-copy"><strong>Carrocerías Aguirre</strong><span>Portal de operación</span></span>
          </Link>
          <div className="sidebar-rule" />
          <nav aria-label="Navegación principal">
            {navigation.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-label">{group.label}</p>
                {group.items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                  return <Link aria-current={active ? "page" : undefined} className={`nav-link${active ? " active" : ""}`} href={item.href} key={item.href} onClick={() => setMobileOpen(false)}>
                    <span className="nav-icon"><Icon name={item.icon} size={17} /></span><span>{item.label}</span>
                  </Link>;
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note"><strong>Espacio de trabajo</strong>Control interno de operación y fabricación.</div>
            {profile && <div className="side-user"><span className="avatar">{initials(profile.nombre)}</span><span className="side-user-copy"><strong>{profile.nombre}</strong><span>{profile.rol.nombre}</span></span></div>}
          </div>
        </aside>

        <div className="main-column">
          <header className="topbar">
            <div className="topbar-left">
              <button aria-label="Abrir menú" className="icon-button mobile-menu" onClick={() => setMobileOpen(true)}><Icon name="menu" size={19} /></button>
              <span className="topbar-caption">SISTEMA INTERNO · OPERACIÓN DE TALLER</span>
            </div>
            <div className="topbar-right">
              <Link aria-label="Ver notificaciones" className="icon-button" href="/notificaciones" title="Notificaciones"><Icon name="bell" size={18} /></Link>
              {profile && <div className="topbar-user"><span className="avatar">{initials(profile.nombre)}</span><span className="topbar-user-copy"><strong>{profile.nombre}</strong><span>{profile.rol.nombre}</span></span></div>}
              <button className="text-link" onClick={() => void signOut()}>Salir</button>
            </div>
          </header>
          <main className="page-content">{children}</main>
        </div>
      </div>
    </AccessGate>
  );
}
