import { HojaDetail } from "./hoja-detail";

export default async function HojaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HojaDetail documentoId={id} />;
}
