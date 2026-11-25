import { DataTable, ModuleNotice, PageHeading, SearchField } from "@/components/ui";

export default function ClientesPage() {
  return <>
    <PageHeading eyebrow="Directorio" title="Clientes" description="Consulta y organiza la información de las personas y empresas atendidas por el taller." action={<button className="button-primary" disabled title="Disponible al conectar las operaciones del backend"><span aria-hidden="true">＋</span>Nuevo cliente</button>} />
    <div className="toolbar-row"><SearchField placeholder="Buscar cliente" /><button className="button-secondary" disabled><span>Filtrar</span></button></div>
    <DataTable columns={["Cliente", "Tipo", "Teléfono", "Correo", "Registro"]} icon="users" title="Aún no hay clientes para mostrar" description="El directorio aparecerá aquí cuando se conecten las operaciones de clientes." />
    <ModuleNotice>La estructura está lista para integrarse con el backend. Las acciones de alta, edición y consulta aún no están habilitadas.</ModuleNotice>
  </>;
}
