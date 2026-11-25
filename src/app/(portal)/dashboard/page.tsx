import Link from "next/link";
import { EmptyState, ModuleNotice } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";

const modules: { label: string; href: string; icon: IconName; detail: string }[] = [
  { label: "Clientes", href: "/clientes", icon: "users", detail: "Directorio de clientes" },
  { label: "Unidades", href: "/unidades", icon: "truck", detail: "Vehículos y series" },
  { label: "Hojas de trabajo", href: "/hojas", icon: "clipboard", detail: "Servicio de taller" },
  { label: "Fabricación", href: "/fabricacion", icon: "factory", detail: "Órdenes y seguimiento" },
];

const indicators: { label: string; icon: IconName; help: string }[] = [
  { label: "Clientes", icon: "users", help: "Directorio de clientes" },
  { label: "Unidades", icon: "truck", help: "Unidades registradas" },
  { label: "Hojas abiertas", icon: "clipboard", help: "Trabajo en curso" },
];

export default function DashboardPage() {
  return (
    <>
      <div className="page-heading">
        <div><p className="page-eyebrow">Panel administrativo</p><h1 className="page-title">Vista general</h1><p className="page-subtitle">Un espacio central para consultar la actividad de taller y el avance de fabricación.</p></div>
        <span className="status-pill"><i className="status-dot" />Vista inicial</span>
      </div>

      <section className="dashboard-welcome">
        <p className="welcome-kicker">Carrocerías Aguirre · Operación</p>
        <h2 className="welcome-title">Bienvenido al portal de trabajo</h2>
        <p className="welcome-copy">Administra la información del taller en un solo lugar. Los módulos están preparados para conectar sus operaciones y mostrar los registros autorizados.</p>
        <span className="welcome-tag">Acceso interno seguro</span>
      </section>

      <section aria-label="Indicadores operativos" className="dashboard-grid">
        {indicators.map((item) => <article className="panel metric-card" key={item.label}>
          <div className="metric-top"><span>{item.label}</span><span className="metric-icon"><Icon name={item.icon} size={17} /></span></div>
          <div className="metric-empty">Pendiente de conexión</div><div className="metric-help">{item.help}</div>
        </article>)}
      </section>

      <div className="dashboard-lower">
        <section className="panel">
          <div className="panel-header"><div><h2>Acceso a módulos</h2><p>Atajos a las áreas de trabajo</p></div><Icon name="arrow-right" size={17} /></div>
          <div className="panel-body"><div className="quick-links">{modules.map((module) => <Link className="quick-link" href={module.href} key={module.href}>
            <span className="quick-link-icon"><Icon name={module.icon} size={17} /></span><span>{module.label}<small style={{ color: "#87949d", display: "block", fontSize: 9, fontWeight: 400, marginTop: 4 }}>{module.detail}</small></span>
          </Link>)}</div></div>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>Actividad reciente</h2><p>Movimientos del portal</p></div><Icon name="activity" size={17} /></div>
          <div className="panel-body"><EmptyState compact icon="activity" title="Sin actividad para mostrar" description="Los movimientos aparecerán aquí cuando se conecten las operaciones del sistema." /></div>
        </section>
      </div>
      <ModuleNotice>La información operativa todavía no está conectada. Esta vista no muestra datos de ejemplo ni modifica registros.</ModuleNotice>
    </>
  );
}
