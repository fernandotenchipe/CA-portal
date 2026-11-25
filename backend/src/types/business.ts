import type { AuthenticatedUser } from "./auth.js";

export interface ClienteRecord {
  id: string;
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  correo: string | null;
  telefono: string | null;
  activo: boolean;
  creado_en: Date | string;
  actualizado_en: Date | string;
}

export interface UnidadRecord {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  numero_serie: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  placas: string | null;
  activo: boolean;
  creado_en: Date | string;
  actualizado_en: Date | string;
}

export interface Page<T> {
  data: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface ListFilters {
  q: string | null;
  limit: number;
  offset: number;
  activo: boolean | null;
}

export interface ClienteListFilters extends ListFilters {}

export interface UnidadListFilters extends ListFilters {
  cliente_id?: string;
  numero_serie?: string;
}

export interface ClienteModuleContract {
  list(filters: ClienteListFilters): Promise<Page<ClienteRecord>>;
  getById(id: string): Promise<ClienteRecord | null>;
  create(input: unknown, actor: AuthenticatedUser): Promise<ClienteRecord>;
  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<ClienteRecord | null>;
}

export interface UnidadModuleContract {
  list(filters: UnidadListFilters): Promise<Page<UnidadRecord>>;
  getById(id: string): Promise<UnidadRecord | null>;
  create(input: unknown, actor: AuthenticatedUser): Promise<UnidadRecord>;
  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<UnidadRecord | null>;
}

export interface DocumentoCortoRecord {
  id: string;
  folio_fisico: string;
  folio_fisico_normalizado: string;
  unidad_id: string;
  cliente_id: string;
  cliente_nombre: string;
  numero_serie: string;
  estado_trabajo: "en_construccion" | "finalizado";
  finalizado_en: Date | string | null;
  observaciones: string | null;
  fecha_documento: string | null;
  creado_en: Date | string;
  actualizado_en: Date | string;
  cancelado_en: Date | string | null;
}

export interface TrabajoRecord {
  id: string;
  documento_corto_id: string;
  numero_orden: number;
  descripcion: string;
  estado: "en_construccion" | "finalizado";
  finalizado_en: Date | string | null;
  cantidad: string | null;
  unidad_medida: string | null;
  precio_unitario: string | null;
  importe: string | null;
  observaciones: string | null;
  creado_en: Date | string;
  actualizado_en: Date | string;
}

export interface DocumentoListFilters {
  q: string | null;
  limit: number;
  offset: number;
  folio_fisico: string | null;
  cliente_id: string | null;
  unidad_id: string | null;
  estado_trabajo: "en_construccion" | "finalizado" | null;
  cancelada: boolean | null;
}

export interface DocumentoModuleContract {
  list(filters: DocumentoListFilters): Promise<Page<DocumentoCortoRecord>>;
  getById(id: string): Promise<DocumentoCortoRecord | null>;
  create(input: unknown, actor: AuthenticatedUser): Promise<DocumentoCortoRecord>;
  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<DocumentoCortoRecord | null>;
  finalize(id: string, actor: AuthenticatedUser): Promise<DocumentoCortoRecord | null>;
}

export interface TrabajoModuleContract {
  listByDocument(documentId: string): Promise<TrabajoRecord[]>;
  create(documentId: string, input: unknown, actor: AuthenticatedUser): Promise<TrabajoRecord>;
  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<TrabajoRecord | null>;
  finalize(id: string, actor: AuthenticatedUser): Promise<TrabajoRecord | null>;
}
