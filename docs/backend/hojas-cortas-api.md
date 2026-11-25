# API de hojas cortas y trabajos

La API usa el esquema existente `public.documentos_cortos`, `public.folios_fisicos_reservados` y `public.trabajos`. Todas las rutas requieren bearer JWT válido, perfil activo y el permiso indicado. Las claves de permisos se prepararon en el backend; no se asignaron a roles ni se ejecutó SQL en Supabase.

## Hojas

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/documentos-cortos` | `documentos_cortos.consultar` |
| POST | `/api/documentos-cortos` | `documentos_cortos.crear` |
| GET | `/api/documentos-cortos/:id` | `documentos_cortos.consultar` |
| PATCH | `/api/documentos-cortos/:id` | `documentos_cortos.editar` |
| POST | `/api/documentos-cortos/:id/finalizar` | `documentos_cortos.editar` |
| GET | `/api/documentos-cortos/:id/trabajos` | `trabajos.consultar` |
| POST | `/api/documentos-cortos/:id/trabajos` | `trabajos.crear` |

### Crear hoja

`POST /api/documentos-cortos` acepta:

```json
{
  "folio_fisico": "AB - 001",
  "unidad_id": "uuid",
  "cliente_id": "uuid",
  "observaciones": "Reparación de caja",
  "fecha_documento": "2026-11-25"
}
```

`folio_fisico`, `unidad_id` son obligatorios. `cliente_id` es opcional y solo se usa como comprobación de consistencia con la unidad; no se almacena en `documentos_cortos`. `observaciones` y `fecha_documento` admiten `null`.

El folio se valida con el formato de la tabla, se convierte a mayúsculas y se guarda con sus espacios internos de captura. La comparación se hace con `folio_fisico_normalizado` de PostgreSQL: elimina espacios y mantiene guiones. El trigger existente crea la reserva inicial. No se inserta directamente en `folios_fisicos_reservados`.

### Listado y búsqueda

`GET /api/documentos-cortos` devuelve `{ data, limit, offset, total }`. Parámetros:

- `folio_fisico`: búsqueda exacta normalizada; también encuentra hojas cuyo folio consultado ahora es histórico.
- `q`: búsqueda parcial en folio actual, serie, cliente, marca o modelo.
- `cliente_id`, `unidad_id`: filtros UUID.
- `estado_trabajo`: `en_construccion` o `finalizado`.
- `cancelada`: `true` o `false` (la cancelación sigue siendo un metadato aparte del estado productivo).
- `limit` (1–100; predeterminado 50), `offset` (predeterminado 0).

No existe filtro `activo` para hojas y se rechaza si se envía. No se exponen datos de contacto de clientes ni IDs/nombres de creadores o finalizadores.

### Editar y finalizar hoja

`PATCH /api/documentos-cortos/:id` admite `folio_fisico`, `unidad_id`, `observaciones` y `fecha_documento`. No acepta estado ni campos de actor. Si se manda `cliente_id`, se comprueba contra la unidad efectiva y no se persiste.

Una hoja en construcción admite esos cambios. Una hoja finalizada o cancelada admite únicamente una corrección de folio; PostgreSQL actualiza la reserva anterior a histórica, reserva el nuevo folio y audita el cambio dentro de la transacción. Un folio histórico o cancelado no puede reutilizarse.

`POST /api/documentos-cortos/:id/finalizar` no lleva cuerpo. PostgreSQL establece actor y fecha de finalización. La operación es idempotente si la hoja ya está finalizada, rechaza hojas canceladas y no consulta ni exige que todos los trabajos estén finalizados.

## Trabajos

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/documentos-cortos/:id/trabajos` | `trabajos.consultar` |
| POST | `/api/documentos-cortos/:id/trabajos` | `trabajos.crear` |
| PATCH | `/api/trabajos/:id` | `trabajos.editar` |
| POST | `/api/trabajos/:id/finalizar` | `trabajos.editar` |

La lista devuelve `{ data: [...] }` y omite trabajos dados de baja lógica. El servidor asigna `numero_orden` incremental bajo bloqueo de la hoja y respeta la unicidad `(documento_corto_id, numero_orden)`.

La creación acepta `descripcion` (obligatoria), `cantidad`, `unidad_medida`, `precio_unitario` y `observaciones` (opcionales, admiten `null`). Estado inicial y `importe` generado los determina PostgreSQL. PATCH admite esos mismos campos salvo que estado, finalización, orden y baja lógica son exclusivos del servidor. No hay borrado físico ni endpoint de baja lógica en esta fase.

`POST /api/trabajos/:id/finalizar` no lleva cuerpo. PostgreSQL fija `estado`, `finalizado_por` y `finalizado_en`. En una hoja finalizada se permite solo finalizar un trabajo pendiente y activo; no se pueden agregar trabajos ni editar otros datos. Las hojas canceladas bloquean mutaciones de sus trabajos.

## Respuestas y errores

Las respuestas de hoja incluyen folio capturado y normalizado, unidad, cliente asociado (nombre), serie de unidad, estado, fechas, observaciones y cancelación. Las respuestas de trabajo incluyen orden, descripción, valores de cantidad/precio/importe y estado/fechas; no incluyen IDs de actor ni datos personales de clientes.

- `400`: cuerpo/campo/filtro inválido o campo no permitido.
- `401`: JWT ausente o inválido.
- `403`: perfil inactivo o permiso insuficiente.
- `404`: hoja, trabajo o unidad inexistente.
- `409`: folio ya reservado, relación cliente-unidad inconsistente o mutación incompatible con el estado.
- `422`: folio, fecha, cantidad, precio o estado de entrada inválido.
- `500`: error interno no clasificable.

Las mutaciones utilizan `withActorTransaction`. Los triggers ya existentes hacen reservas, validación de estados, finalización, auditoría y notificaciones. El backend no implementa un segundo mecanismo de auditoría ni modifica triggers.

## Estado de permisos y esquema

Permisos preparados (requieren aprobación y asignación externa): `documentos_cortos.consultar`, `documentos_cortos.crear`, `documentos_cortos.editar`, `trabajos.consultar`, `trabajos.crear`, `trabajos.editar`. Las operaciones de finalización usan el permiso `editar` conforme a las reglas de integridad documentadas. No hay matriz asignada para este módulo.

El contrato se basa en las seis migraciones y los dos parches versionados en el repositorio. La consulta directa del esquema vivo de Supabase no se hizo porque esta tarea prohíbe ejecutar SQL allí; esa instancia debe verificarse en una tarea autorizada antes de habilitar tráfico productivo.
