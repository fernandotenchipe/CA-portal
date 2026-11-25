import type { AuthenticatedUser } from "../../types/auth.js";
import type { DocumentoCortoRecord, DocumentoListFilters, Page } from "../../types/business.js";
import type { DocumentoCreateInput, DocumentoUpdateInput } from "../../validations/index.js";
import { validateDocumentoCreate, validateDocumentoUpdate } from "../../validations/index.js";
import { DocumentoRepository } from "./repository.js";

export class DocumentosModule {
  constructor(private readonly repository = new DocumentoRepository()) {}

  list(filters: DocumentoListFilters): Promise<Page<DocumentoCortoRecord>> {
    return this.repository.list(filters);
  }

  getById(id: string): Promise<DocumentoCortoRecord | null> {
    return this.repository.getById(id);
  }

  create(input: unknown, actor: AuthenticatedUser): Promise<DocumentoCortoRecord> {
    const validated: DocumentoCreateInput = validateDocumentoCreate(input);
    return this.repository.create(validated, actor);
  }

  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<DocumentoCortoRecord | null> {
    const validated: DocumentoUpdateInput = validateDocumentoUpdate(input);
    return this.repository.update(id, validated, actor);
  }

  finalize(id: string, actor: AuthenticatedUser): Promise<DocumentoCortoRecord | null> {
    return this.repository.finalize(id, actor);
  }
}
