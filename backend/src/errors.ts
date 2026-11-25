export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "request_error",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function publicDatabaseError(error: unknown): HttpError {
  const databaseError = error as { code?: string; constraint?: string };
  if (databaseError?.code === "23505") {
    if (databaseError.constraint === "unidades_numero_serie_uq") {
      return new HttpError(409, "El número de serie ya está registrado.", "duplicate_serial");
    }
    if (databaseError.constraint === "folios_reservados_normalizado_uq") {
      return new HttpError(409, "El folio físico ya fue utilizado y permanece reservado.", "physical_folio_reserved");
    }
    if (databaseError.constraint === "trabajos_orden_documento_uq") {
      return new HttpError(409, "No se pudo asignar el orden del trabajo por un conflicto concurrente. Inténtalo nuevamente.", "work_order_conflict");
    }
    return new HttpError(409, "El registro entra en conflicto con datos existentes.", "duplicate_record");
  }
  if (databaseError?.code === "23503") {
    return new HttpError(409, "La relación solicitada ya no existe o está en uso.", "foreign_key_conflict");
  }
  if (databaseError?.code === "23514" || databaseError?.code === "22P02") {
    return new HttpError(422, "Los datos no cumplen las reglas del esquema.", "constraint_violation");
  }
  if (databaseError?.code === "P0001") {
    return new HttpError(409, "La operación no está permitida por el estado actual del registro.", "business_rule_conflict");
  }
  return new HttpError(500, "No se pudo completar la operación.", "internal_error");
}
