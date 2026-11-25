import type { AuthenticatedUser } from "../../types/auth.js";
import type { Page, UnidadListFilters, UnidadRecord } from "../../types/business.js";
import type { UnidadCreateInput, UnidadUpdateInput } from "../../validations/index.js";
import { validateUnidadCreate, validateUnidadUpdate } from "../../validations/index.js";
import { UnidadRepository } from "./repository.js";

export class UnidadesModule {
  constructor(private readonly repository = new UnidadRepository()) {}

  list(filters: UnidadListFilters): Promise<Page<UnidadRecord>> {
    return this.repository.list(filters);
  }

  getById(id: string): Promise<UnidadRecord | null> {
    return this.repository.getById(id);
  }

  create(input: unknown, actor: AuthenticatedUser): Promise<UnidadRecord> {
    const validated: UnidadCreateInput = validateUnidadCreate(input);
    return this.repository.create(validated, actor);
  }

  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<UnidadRecord | null> {
    const validated: UnidadUpdateInput = validateUnidadUpdate(input);
    return this.repository.update(id, validated, actor);
  }
}
