import type { AuthenticatedUser } from "../../types/auth.js";
import type { TrabajoRecord } from "../../types/business.js";
import type { TrabajoCreateInput, TrabajoUpdateInput } from "../../validations/index.js";
import { validateTrabajoCreate, validateTrabajoUpdate } from "../../validations/index.js";
import { TrabajoRepository } from "./trabajos-repository.js";

export class TrabajosModule {
  constructor(private readonly repository = new TrabajoRepository()) {}

  listByDocument(documentId: string): Promise<TrabajoRecord[]> {
    return this.repository.listByDocument(documentId);
  }

  create(documentId: string, input: unknown, actor: AuthenticatedUser): Promise<TrabajoRecord> {
    const validated: TrabajoCreateInput = validateTrabajoCreate(input);
    return this.repository.create(documentId, validated, actor);
  }

  update(id: string, input: unknown, actor: AuthenticatedUser): Promise<TrabajoRecord | null> {
    const validated: TrabajoUpdateInput = validateTrabajoUpdate(input);
    return this.repository.update(id, validated, actor);
  }

  finalize(id: string, actor: AuthenticatedUser): Promise<TrabajoRecord | null> {
    return this.repository.finalize(id, actor);
  }
}
