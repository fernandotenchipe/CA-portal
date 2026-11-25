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
