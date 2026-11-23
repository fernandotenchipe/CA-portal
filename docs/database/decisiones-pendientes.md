# Aprobaciones incorporadas y pendientes reales

## Decisiones aprobadas por el negocio

- Arquitectura: Next.js/Vercel, backend Node.js + TypeScript en VPS, PostgreSQL/Supabase, Supabase Auth y Storage privado.
- Serie alfanumérica A-Z/0-9, sin espacios ni guiones, en mayúsculas, globalmente única; doble captura y no pegar son reglas del futuro formulario/servidor.
- El folio físico conserva guiones, ignora espacios y capitalización para comparar. Toda corrección conserva y reserva el anterior, registra nuevo folio, autor y hora; trabajador con permiso de edición puede corregir sin aprobación administrativa.
- Hojas canceladas se conservan; folios cancelados o históricos no se reutilizan. Cancelación es metadato independiente del estado productivo.
- Estados de trabajo/fabricación: solo `en_construccion` y `finalizado`. La finalización guarda actor y tiempo; finalizados son de consulta para acciones normales.
- Hojas cortas pueden tener múltiples trabajos; la orden larga es opcional, una como máximo por hoja, y crea una primera versión técnica.
- Versiones completas inmutables, creadas con bloqueo de orden; excepciones de especificaciones requieren función restringida, motivo y auditoría.
- Evidencias en Storage privado, baja lógica con usuario/fecha; conservar archivo binario sin purga automática hasta aprobar retención.
- Facturación fiscal fuera de V1: no CFDI, pagos, anticipos, parcialidades ni pantallas. Mantener facturas como módulo futuro separado.
- Roles iniciales Administración, Ventas y Logística; cualquier trabajador con permiso puede realizar la operación asignada, sin aprobación administrativa general.
- Solo Administración puede consultar auditoría detallada. Cambios relevantes generan un aviso general para usuarios activos; no se filtran snapshots sensibles a trabajadores.
- Reporte diario a designados activos de Administración: 8:00 a. m., zona `America/Monterrey`, periodo del día calendario anterior.

## Pendientes que sí requieren definición

| Pendiente | Motivo / impacto | Situación en la propuesta |
|---|---|---|
| ¿Se permiten huecos en folio digital de fabricación? | Las secuencias PostgreSQL son concurrentes y rápidas, pero un rollback o fallo puede consumir un número. Evitar huecos exige contador transaccional serializado y política para anulaciones. | Se usa `IDENTITY UNIQUE`; es deliberadamente creciente pero no gapless. No se usa `MAX+1` sin lock. |
| ¿Puede reactivarse una hoja/orden cancelada? | No se definió quién puede reabrir ni cómo se representa la cancelación previa. | `cancelado_por/en` separado y auditado; SQL no fija una regla final de reactivación. Limpiar esos campos vuelve a habilitar operación y queda auditado; API debe restringir según la decisión. |
| ¿Qué excepciones se permitirán tras finalización? | Las versiones excepcionales de órdenes ya requieren motivo y función restringida; falta política equivalente para reabrir hoja o corregir un trabajo finalizado. | Cambios normales quedan bloqueados. No se creó endpoint ni una función genérica que abra esos registros. Definir operaciones, roles autorizados y motivo requerido antes de implementarlas. |
| Retención de imágenes eliminadas | La fila y actor/hora se conservan, pero se debe definir cuánto tiempo mantener el objeto binario y quién puede purgarlo. | Sin borrado físico automático. Storage privado; signed URLs y limpieza requieren políticas futuras. |
| ¿Se puede restaurar una evidencia dada de baja? | No se pidió restauración, pero puede ser necesaria ante una eliminación accidental. | El trigger actual conserva la baja y bloquea restauración/cambio posterior. Aprobar si se añade una operación restaurar, que debe quedar auditada. |
| Modelo fiscal futuro | No se confirma si factura se identifica por UUID CFDI, serie/folio u otro id; tampoco si la relación 1:1 sirve. | Sólo existe un borrador fuera de `supabase/migrations/`; no forma parte de la V1 ni se considera decisión aprobada. |
| Campos obligatorios de la plantilla técnica | Se listaron tipo, medidas, materiales, piso, puertas, redilas, luces, protecciones, accesorios/equipamiento y observaciones, sin formato ni obligatoriedad final. | JSONB versionado y `version_esquema`; estructura detallada se validará en backend cuando se cierre la plantilla. |
| Matriz módulo/operación por rol | Nombres de roles aprobados, pero no se definió qué pantallas/acciones puede hacer cada rol ni quién administra permisos. | Permisos normalizados y asignables; el permiso auditoría detallada está reservado a Administración. No se asignan permisos de operación por inferencia. |
| Establecer contexto seguro de actor por transacción | El trigger exige `app.actor_tipo` y `app.actor_id`; GUC por sí solo no autentica a quien tiene credenciales SQL. PostgREST no conserva un `SET LOCAL` entre llamadas separadas. | Decidido para el backend: usar `pg` con un pool PostgreSQL y transacción que fije ambos GUC con alcance local. La conexión y el patrón están preparados, pero la verificación Auth/JWT, el perfil/permisos y las operaciones aún no están implementados. Nunca aceptar UUID del actor desde el body del navegador. |
| Proveedor e idempotencia de email | Una fila y clave por fecha/destinatario evita ejecuciones duplicadas en DB, pero un timeout de entrega puede ser ambiguo. | Se guarda clave idempotente para pasar al proveedor. Exactly-once depende de que el proveedor soporte idempotencia; si no, existe riesgo de duplicado en timeout. |
| Realtime y permisos de detalle | La persistencia crea notificación general para todos los usuarios activos; la entrega en vivo y detalles privados dependen de controles que no se implementan aquí. | No hay publicación Realtime/policies. El backend restringirá auditoría a Administración y dará detalles de cambio según permiso. |

## Supuestos técnicos explícitos

- Finalizar una hoja corta no depende del estado de sus trabajos ni de su orden. Si el negocio requiere una regla agregada más adelante, se deberá definir y aprobar antes de incorporarla.

- Cada hoja corta pertenece a una unidad existente; la unidad no puede crearse sin serie válida. Si el taller requiere crear una hoja sin unidad identificada, cambiar `unidad_id NOT NULL` antes de migrar.
- UUID y roles usan los servicios de Supabase ya aprobados. El esquema inicial requiere `auth.users`, roles SQL `anon`, `authenticated`, `service_role` y RLS.
- La normalización de folio y serie usa ASCII; en folios los guiones son significativos. Si se necesitan letras acentuadas, cambiar check de formato antes de migrar.
