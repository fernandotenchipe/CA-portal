import { DataTable, ModuleNotice, PageHeading, SearchField } from "@/components/ui";

export default function HojasPage() {
  return <>
    <PageHeading eyebrow="Operación de taller" title="Hojas de trabajo" description="Da seguimiento a los servicios, trabajos solicitados y evidencias de cada unidad." action={<button className="button-primary" disabled title="Disponible al conectar las operaciones del backend"><span aria-hidden="true">＋</span>Nueva hoja</button>} />
    <div className="toolbar-row"><SearchField placeholder="Buscar folio, cliente o unidad" /><button className="button-secondary" disabled>Filtrar</button></div>
    <DataTable columns={["Folio", "Cliente", "Unidad", "Trabajos", "Estado", "Fecha"]} icon="clipboard" title="Aún no hay hojas de trabajo" description="Las hojas se mostrarán aquí cuando se habilite la integración operativa." />
    <ModuleNotice>Los folios, transiciones de estado y auditoría se gestionarán mediante el backend cuando se implemente el flujo de negocio.</ModuleNotice>
  </>;
}
