# Diccionario de datos — V4 consolidado

Las tablas de este documento pertenecen a las seis migraciones iniciales. `facturas_externas` está fuera y se describe como borrador futuro en `supabase/future_migrations/`. Todas las claves UUID se generan con `gen_random_uuid()` salvo `usuarios.id`, que coincide con `auth.users.id`; auditoría usa `bigint identity`.

## Catálogos, usuarios y acceso

| Tabla | Columnas y tipos | Claves y reglas |
|---|---|---|
| `roles` | `id uuid`, `codigo text`, `nombre text`, `descripcion text`, `activo boolean`, `creado_en timestamptz` | `id` PK; código y nombre únicos. Se insertan los tres roles iniciales aprobados. `codigo` es inmutable; se pueden agregar roles nuevos. |
| `permisos` | `id uuid`, `modulo text`, `operacion text`, `descripcion text` | PK; `(modulo, operacion)` único. El permiso `auditoria.consultar` se asigna a Administración; otros permisos se definirán con la matriz operativa. Las claves son inmutables. |
| `rol_permisos` | `rol_id uuid`, `permiso_id uuid`, `creado_en timestamptz` | PK compuesta y FKs `RESTRICT`; no duplicados. El módulo `auditoria` no se concede a roles distintos de Administración y su asignación inicial no se elimina. |
| `usuarios` | `id uuid`, `rol_id uuid`, `nombre text`, `activo boolean`, `recibe_reporte_diario boolean`, `creado_en/actualizado_en timestamptz` | PK y FK `auth.users`; un rol requerido. Solo Administración activa puede ser designada para el correo diario. Perfil se desactiva, no se borra. |

## Clientes, camiones, hojas y trabajos

| Tabla | Columnas y tipos | Claves y reglas |
|---|---|---|
| `clientes` | `id uuid`, `nombre text`, `razon_social/rfc/correo/telefono text`, `activo boolean`, fechas `timestamptz` | PK; nombre requerido; campos fiscales y de contacto opcionales hasta confirmar formulario. |
| `unidades` | `id uuid`, `cliente_id uuid`, `numero_serie text`, `marca/modelo/placas text`, `anio smallint`, `activo boolean`, fechas `timestamptz` | PK; FK obligatoria a cliente; número de serie único con CHECK `^[A-Z0-9]+$`. Se almacena una sola columna canónica en mayúsculas; no espacios ni guiones. |
| `documentos_cortos` | `id uuid`, `folio_fisico text`, `folio_fisico_normalizado text` generada, `unidad_id uuid`, `estado_trabajo text`, `finalizado_por uuid`, `finalizado_en timestamptz`, `observaciones text`, `fecha_documento date`, creador/fechas, datos de cancelación | PK; FK obligatoria a unidad; folio capturado conserva letras/números/guiones y puede incluir espacios, CHECK del formato elimina espacios al comparar. Estado de trabajo `en_construccion/finalizado`; cancelación se expresa con `cancelado_por/en`, independiente del estado. |
| `folios_fisicos_reservados` | `id uuid`, `documento_corto_id uuid`, `folio_capturado text`, `folio_normalizado text` generada, `es_actual boolean`, `registrado_por uuid`, `registrado_en timestamptz` | PK; folio normalizado global UNIQUE; índice parcial permite un folio actual por hoja. Historial append-only excepto pasar reserva actual a histórica. El trigger principal crea la reserva inicial y reserva cada corrección en la misma transacción. |
| `trabajos` | `id uuid`, `documento_corto_id uuid`, `numero_orden integer`, `descripcion text`, `estado text`, datos de finalización, `cantidad numeric(12,3)`, `unidad_medida text`, `precio_unitario numeric(14,2)`, `importe numeric(16,2)` generado, observaciones, datos de baja lógica y fechas | PK; FK a hoja; orden único por hoja. Estado `en_construccion/finalizado`; se guarda usuario y hora al finalizar. Bajo hoja finalizada se permite solo finalizar un trabajo pendiente sin alterar sus demás datos; trabajo eliminado lógicamente no se finaliza. Baja lógica usa `eliminado_en/por`; borrado físico bloqueado. |

## Fabricación e impresiones

| Tabla | Columnas y tipos | Claves y reglas |
|---|---|---|
| `ordenes_fabricacion` | `id uuid`, `documento_corto_id uuid`, `folio_digital bigint identity`, `estado text`, datos de finalización y cancelación, fechas estimadas/reales, creador y fechas | PK; FK UNIQUE a documento corto; estado `en_construccion/finalizado`; cancelación independiente. Bajo hoja finalizada se permite solo finalizar una orden pendiente sin alterar sus demás datos. `folio_digital` único y automático; huecos posibles. Crear orden crea V1 automáticamente. |
| `versiones_fabricacion` | `id uuid`, `orden_fabricacion_id uuid`, `numero_version integer`, `version_esquema integer`, `especificaciones jsonb`, `es_excepcional boolean`, `motivo_excepcional text`, `creada_por uuid`, `creada_en timestamptz` | PK; `(orden, numero_version)` UNIQUE; JSONB debe ser objeto. `crear_version_fabricacion` bloquea la orden y calcula número seguro; tabla no permite UPDATE/DELETE ni INSERT directo desde service_role. Excepción requiere motivo y RPC protegida. |
| `impresiones` | `id uuid`, `version_fabricacion_id uuid`, `estado text`, `solicitada_por/en`, `confirmada_por/en`, `impresora text`, `detalle_fallo text` | PK; FK a versión. Estado técnico: solicitada/confirmada/fallida/cancelada. Trigger atribuye actor y fecha; solo se confirma luego de una solicitud y la confirmación es inmutable. |

## Evidencias

| Tabla | Columnas y tipos | Claves y reglas |
|---|---|---|
| `evidencias` | `id uuid`, `documento_corto_id uuid`, `ruta_storage text`, nombre/tipo, tamaño `bigint`, `sha256 text`, `subida_por uuid`, fechas, `eliminada_por uuid`, `eliminada_en timestamptz` | PK; ruta única a objeto en bucket privado; no se guarda URL pública ni binario. Subida y eliminación requieren usuario. La baja es lógica e irreversible en esta propuesta; el archivo físico se conserva hasta aprobar retención. Escritura se bloquea cuando la hoja está finalizada o cancelada, según el estado de la hoja, sin depender del estado de trabajos u orden. |

## Auditoría, notificaciones y reportes

| Tabla | Columnas y tipos | Claves y reglas |
|---|---|---|
| `auditoria` | `id bigint identity`, `tipo_actor text`, `usuario_id uuid`, `operacion text`, `entidad text`, `entidad_id text`, JSONB anterior/nuevo, `correlacion_id uuid`, `registrado_en timestamptz` | `tipo_actor` usuario/sistema; solo usuario lleva FK. Acción INSERT/UPDATE/CANCEL/DELETE. Registro append-only, sin acceso directo público; service_role tiene SELECT y el backend filtra consultas a Administración. |
| `notificaciones` | UUID, `auditoria_id bigint`, `titulo/mensaje text`, `creada_en timestamptz` | Una por cada auditoría; texto general sin snapshots ni detalles sensibles. Se crea en el mismo commit del cambio. |
| `notificacion_usuarios` | `notificacion_id uuid`, `usuario_id uuid`, `leida_en/creada_en timestamptz` | PK compuesta; el trigger crea destinatario para cada usuario activo. Lectura pendiente cuando `leida_en IS NULL`. |
| `reportes_diarios` | UUID, `fecha_envio_local date`, `zona_horaria text`, `hora_programada time`, `periodo_desde/hasta timestamptz`, estado, resumen JSONB, fechas de proceso | Una fila por fecha local de envío. Zona fija `America/Monterrey`, hora 08:00 y ventana exacta del día local anterior. Estado pendiente/procesando/completado/fallido. |
| `reportes_diarios_destinatarios` | UUID, reporte, usuario, `clave_idempotencia text` generada, estado, intentos, tiempos, resultado proveedor y error | Una fila por reporte/usuario; clave externa estable única. Solo destinatarios activos designados de Administración. Resultado por destinatario para reintentar fallidos sin reenviar los completados. |

## Migración futura no inicial

`facturas_externas` aparece como borrador en `supabase/future_migrations/202611180007_billing_external_draft.sql`. La clave del emisor/referencia y la asociación uno-a-uno son tentativas; el borrador no debe aplicarse hasta aprobar el modelo fiscal futuro.
