# Reglas de integridad V4

## Identificadores y folios

| Regla aprobada | Garantía en PostgreSQL | Responsabilidad del backend / frontend |
|---|---|---|
| Número de serie obligatorio, alfanumérico, sin espacios ni guiones, único y en mayúsculas | `unidades.numero_serie` tiene `CHECK '^[A-Z0-9]+$'` y `UNIQUE`. Un valor vacío también falla. | UI captura dos veces y desactiva pegar; servidor valida ambas entradas, las compara, transforma a mayúsculas y persiste un solo valor. Errores de UNIQUE por concurrencia deben presentarse con mensaje claro. |
| Corregir una serie sin aprobación de Administración | UPDATE de unidad pasa por auditoría anterior/nuevo y notificación automática; la unicidad bloquea colisiones | Requiere permiso de edición en API. El GUC del actor se fija en el servidor luego de validar Auth, nunca se acepta el UUID de actor directamente desde el navegador. |
| Folio alfanumérico con guiones significativos; espacios no significativos; comparar en mayúscula | Checks aceptan solo letras, números, guiones y espacios; columna generada elimina espacios y convierte a mayúsculas, preservando guiones. La tabla `folios_fisicos_reservados` aplica UNIQUE histórico global. | Mostrar el capturado, comparar el normalizado. Casos `AB-001` y `AB001` son diferentes; `ab - 001` y `AB-001` son iguales. |
| Corregir folio y no reutilizar el anterior | Trigger al insertar hoja reserva primera captura; trigger al actualizar hoja marca la reserva anterior histórica e inserta la nueva en la misma transacción. UNIQUE rechaza todo folio usado, incluso anterior/cancelado. La hoja no se puede borrar y el acceso directo a tabla de reservas está revocado. | Permiso `documentos.editar` en servidor; no se necesita permiso de aprobación Admin. Un conflicto de UNIQUE revierte toda la operación. La auditoría del documento conserva valor anterior/nuevo, actor y hora. |

## Trabajos, fabricación y cancelación

| Regla aprobada | Garantía en PostgreSQL | Responsabilidad del backend |
|---|---|---|
| Cada hoja se liga a un camión identificado | `documentos_cortos.unidad_id NOT NULL`; FK a una unidad con serie válida | Crear primero la unidad o seleccionarla; no permitir ingreso de unidad sin ambas capturas coincidentes. |
| Solo estados de producción `en_construccion` y `finalizado` | CHECK en hoja, cada trabajo y orden. Al transicionar a finalizado, trigger escribe actor y `clock_timestamp()`. CHECK hace obligatorios ambos campos. No hay dependencia entre finalizar una hoja y el estado de sus trabajos u orden. | Finalizar mediante operación ordinaria solo con permiso de edición. Una regla agregada puede añadirse después si el negocio la necesita y aprueba. |
| Finalizados de consulta para operaciones normales, manteniendo cierre de hijos pendientes | Bajo hoja finalizada, un trabajo u orden solo admite la transición `en_construccion` → `finalizado`, sin cambiar ningún otro campo. Trabajos borrados lógicamente no admiten esa transición. El trigger asigna actor y hora; la mutación queda auditada. | El backend exige el permiso de edición para esa operación. El trigger requiere contexto de usuario válido, pero la matriz de permisos aún se valida en la API; no se exponen modificaciones de contenido. |
| Una hoja admite máximo una orden y una orden pertenece a una hoja | `ordenes_fabricacion.documento_corto_id` NOT NULL UNIQUE/FK | Confirmar que la orden se use exclusivamente para fabricación de carrocería nueva. |
| Cada orden comienza con V1, cambios posteriores generan versiones | Trigger al crear orden inserta V1 vacío; INSERT/UPDATE/DELETE directos de versiones se bloquean/revocan. RPC ordinario bloquea fila de orden `FOR UPDATE`, calcula `MAX+1`, inserta snapshot JSONB y actor. UNIQUE secundario protege concurrencia. | Cada guardado de especificaciones invoca una creación de versión; no sobrescribir V1/V2. Backend valida campos de JSON según esquema vigente y permiso de excepción si orden finalizada. |
| Identificar versión vigente e impresión pendiente | Vigente = mayor `numero_version`. Toda nueva versión queda por encima de impresiones previas; pendiente si esa versión no tiene impresión confirmada. | Presentar consulta derivada; no guardar banderas desincronizadas. |
| Distinguir solicitar impresión de confirmarla | Trigger fuerza estado/solicitante/fecha de solicitud; solo transición a confirmada/fallida/cancelada; confirmación guarda usuario/hora y no puede editarse después. Solo la versión vigente acepta nuevas solicitudes. | Confirmar solo después de verificar que la impresora produjo la hoja. Historial no se borra. |
| Cancelar sin convertirlo en estado de producción | `cancelado_por/en` son campos separados en hoja y orden; actor/hora fijados al cancelar y coherencia CHECK. Documentos y órdenes no se borran. | Operación backend separada, con permiso y auditoría. Reactivación de documentos cancelados se deja abierta; no hay endpoint implementado. |

## Fotografías y acceso

- PostgreSQL guarda referencia y metadatos; los objetos se guardan en bucket privado, sin URL pública permanente.
- Trigger asigna autor al subir y al eliminar, impide cambios de ruta/origen y borrado físico de la fila. Eliminar cambia `eliminada_en/por`; el objeto se conserva físicamente hasta aprobar retención.
- PostgreSQL bloquea escritura de evidencia si la hoja está finalizada o cancelada. El bloqueo depende únicamente del estado de la hoja, con independencia de los estados de trabajos y orden. La excepción para completar el estado de un hijo no abre edición de evidencia ni otros datos.
- Al marcar eliminación, el backend mantiene archivo en Storage. La eliminación lógica genera trigger de auditoría y notificación.
- El objeto y la fila PostgreSQL no comparten transacción; el servicio necesita compensación o cola de reconciliación si falla una mitad.
- RLS se habilita sin políticas. `anon` y `authenticated` quedan denegados; `service_role` omite RLS y es solo backend. El servidor no debe confiar en que RLS autorice una petición service role.

## Auditoría y notificaciones

- Cada mutación en roles, permisos, vínculos de rol, usuarios, clientes, unidades, documentos, trabajos, órdenes, versiones, impresiones y evidencias dispara un trigger AFTER transaccional. Old/new JSONB se guardan en la misma transacción.
- El trigger requiere `app.actor_tipo` y valida `app.actor_id`: `usuario` debe existir; `sistema` exige actor UUID vacío. Falta o formato inválido hace fallar la mutación; no queda un autor nulo silencioso. La tabla comprueba la combinación tipo/usuario.
- El backend deriva el usuario desde JWT validado y establece contexto local por transacción; jamás acepta un actor UUID libre del navegador. Un GUC personalizado no autentica por sí solo: es confiable solo si ningún navegador obtiene credenciales de DB y el backend controla la conexión/operación. Con PostgREST service role sin transacción compartida, habrá que usar conexión PostgreSQL transaccional o RPC de mutación controlada.
- El audit log niega UPDATE/DELETE, tiene privilegios directos revocados y solo se consulta por el backend después de comprobar rol/capacidad de Administración. `auditoria.consultar` está asignado a ADMINISTRACION y una trigger impide conceder ese permiso a otro rol. Las demás consultas del backend no deben incluir snapshots para trabajadores.
- Una función AFTER INSERT de auditoría crea un resumen general y destinatario por cada usuario activo, en el mismo commit. No incluye valores anteriores/nuevos. El backend filtra detalles sensibles y puede mostrar actor humano o `El sistema`.
- No se auditan las filas de notificación/reporte para evitar recursión/ruido; los cambios fuente sí tienen auditoría. La persistencia queda preparada, pero no hay publicación Realtime ni servicio de entrega en vivo todavía.
- Un propietario/superusuario de la base puede retirar triggers; se requieren controles administrativos y backups. No se copian datos de Auth/tokens a snapshots.

## Reporte diario

- `fecha_envio_local` es única; ventana comprobada en SQL: de medianoche del día anterior a medianoche del día de envío, ambas convertidas con `America/Monterrey`; la hora programada es 08:00.
- Se guarda un registro padre por ejecución y uno por usuario designado activo de Administración. Cada destinatario tiene una clave idempotente estable, estado, contador/fecha de intento, ID de proveedor y error.
- El scheduler debe reclamar la fila con transacción/bloqueo (`FOR UPDATE SKIP LOCKED` o equivalente); no se permite dos trabajadores a procesar la misma entrega simultáneamente.
- Reintentar solo destinatarios fallidos. Si el proveedor admite idempotencia, usar la clave guardada. Si acepta el correo y hay timeout antes de persistir `enviado`, sin idempotencia externa puede salir un duplicado; no se puede prometer exactly-once solo con PostgreSQL.
- `resumen` debe representar explícitamente cero movimientos cuando el periodo anterior no tenga eventos. No se programa cron ni envío en esta tarea.

## Facturación futura

No hay tablas ni FK de facturas en las migraciones iniciales. El draft fuera del directorio `supabase/migrations/` conserva una relación 0:1 como opción previa, no aprobada. No incluye CFDI, pago, anticipos ni parcialidades. La clave externa y cardinalidad requieren decisión posterior.
