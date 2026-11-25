import { DataTable, ModuleNotice, PageHeading, SearchField } from "@/components/ui";

export default function UnidadesPage() {
  return <>
    <PageHeading eyebrow="Directorio" title="Unidades" description="Consulta los vehículos vinculados a los clientes y su información de identificación." action={<button className="button-primary" disabled title="Disponible al conectar las operaciones del backend"><span aria-hidden="true">＋</span>Nueva unidad</button>} />
    <div className="toolbar-row"><SearchField placeholder="Buscar por serie o descripción" /><button className="button-secondary" disabled>Filtrar</button></div>
    <DataTable columns={["Unidad", "Serie", "Cliente", "Marca y modelo", "Estado"]} icon="truck" title="Aún no hay unidades para mostrar" description="Las unidades registradas aparecerán aquí al conectar este módulo." />
    <ModuleNotice>La serie de unidad conservará las reglas de validación aprobadas al conectar el formulario y la API.</ModuleNotice>
  </>;
}
