import { DataTable, ModuleNotice, PageHeading, SearchField } from "@/components/ui";

export default function FabricacionPage() {
  return <>
    <PageHeading eyebrow="Producción" title="Órdenes de fabricación" description="Consulta el avance de fabricación, las hojas relacionadas y las versiones técnicas." action={<button className="button-primary" disabled title="Disponible al conectar las operaciones del backend"><span aria-hidden="true">＋</span>Nueva orden</button>} />
    <div className="toolbar-row"><SearchField placeholder="Buscar orden, cliente o folio" /><button className="button-secondary" disabled>Filtrar</button></div>
    <DataTable columns={["Orden", "Folio de hoja", "Cliente", "Versión", "Estado", "Actualización"]} icon="factory" title="Aún no hay órdenes para mostrar" description="Las órdenes aparecerán aquí cuando se conecte el flujo de fabricación." />
    <ModuleNotice>Las versiones técnicas se conservarán como snapshots inmutables al desarrollar la integración con el backend.</ModuleNotice>
  </>;
}
