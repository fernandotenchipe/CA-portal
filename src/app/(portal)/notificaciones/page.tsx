import { EmptyState, ModuleNotice, PageHeading } from "@/components/ui";

export default function NotificacionesPage() {
  return <>
    <PageHeading eyebrow="Centro de mensajes" title="Notificaciones" description="Consulta avisos relacionados con la actividad y los procesos del taller." />
    <section className="panel">
      <div className="panel-header"><div><h2>Bandeja de notificaciones</h2><p>Avisos dirigidos a tu cuenta</p></div><span className="status-pill"><i className="status-dot" />Sin datos</span></div>
      <div className="panel-body" style={{ paddingBottom: 34, paddingTop: 34 }}><EmptyState icon="bell" title="No hay notificaciones para mostrar" description="Los avisos aparecerán aquí cuando se habilite el servicio de notificaciones." /></div>
    </section>
    <ModuleNotice>Esta pantalla no incluye snapshots de auditoría ni contenido sensible de otros módulos.</ModuleNotice>
  </>;
}
