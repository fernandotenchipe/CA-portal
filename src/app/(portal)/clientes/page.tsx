import { PageHeading } from "@/components/ui";
import { ClientesList } from "./clientes-list";

export default function ClientesPage() {
  return <>
    <PageHeading eyebrow="Directorio" title="Clientes" description="Consulta y organiza la información de las personas y empresas atendidas por el taller." action={<button className="button-primary" disabled title="El registro estará disponible en una fase posterior"><span aria-hidden="true">＋</span>Nuevo cliente</button>} />
    <ClientesList />
  </>;
}
