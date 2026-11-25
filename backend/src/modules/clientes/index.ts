import type { AuthenticatedUser } from "../../types/auth.js";
import type { ClienteCreateInput, ClienteUpdateInput } from "../../validations/index.js";
import type { ClienteListFilters, ClienteRecord, Page } from "../../types/business.js";
import { validateClienteCreate, validateClienteUpdate } from "../../validations/index.js";
import { ClienteRepository } from "./repository.js";

export class ClientesModule {
  constructor(private readonly repository = new ClienteRepository()) {}

  list(filters: ClienteListFilters): Promise<Page<ClienteRecord>> {
    return this.repository.list(filters);
  }

  getById(id: string): Promise<ClienteRecord | null> {
    return this.repository.getById(id);
  }

  create(input: unknown, actor: AuthenticatedUser): Promise<ClienteRecord> {
    const validated: ClienteCreateInput = validateClienteCreate(input);
    return this.repository.create(validated, actor);
  }

  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<ClienteRecord | null> {
    const validated: ClienteUpdateInput = validateClienteUpdate(input);
    return this.repository.update(id, validated, actor);
  }
}
