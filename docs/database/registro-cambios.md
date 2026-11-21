# Registro de cambios de consolidación V4

## Corrección de orden de triggers de reportes

- Se movieron `reportes_destinatarios_validar` y `reportes_destinatario_resultado_proteger` para crearlos después de `public.reportes_diarios_destinatarios` y sus índices, dentro de `202611180005_audit_notifications_reports.sql`. No cambian las reglas de negocio ni las funciones asociadas.
- Se revisó el orden de las seis migraciones: no se encontraron otras referencias prematuras en `CREATE TRIGGER`, `ALTER TABLE`, claves foráneas, políticas o concesiones; las demás dependencias se crean previamente o pertenecen a migraciones anteriores.
- Como hubo intentos manuales en Supabase, el estado remoto es desconocido. Se añadió `docs/database/recuperacion-ejecucion-manual.md` con consultas de solo lectura y rutas de recuperación no destructivas. No se conectó ni ejecutó SQL remoto y no se recomienda reaplicar hasta revisar los resultados.
- La corrección es estática; no se validó ejecutando PostgreSQL porque el entorno local no dispone de servidor/cliente y Docker no está accesible.

Fecha de consolidación: 2026-11-19. Cambios solo en diseño SQL y documentación; no se ejecutaron.

## Ajuste previo a validación técnica

- Se eliminó del trigger de estado la condición que obligaba a finalizar todos los trabajos y la orden antes de finalizar una hoja corta. La hoja conserva solo los estados `en_construccion` y `finalizado`; la agregación queda como opción futura sujeta a aprobación del negocio.
- Se permitió finalizar únicamente el estado de trabajos/órdenes pendientes bajo una hoja finalizada. El trigger compara la fila completa excluyendo estado, metadatos de finalización y `actualizado_en`; cambios adicionales y trabajos con baja lógica se rechazan. Actor y auditoría se mantienen obligatorios.
- La revisión estática confirmó seis migraciones iniciales ordenadas, 18 tablas y referencias a tablas públicas existentes; facturación sigue fuera del orden inicial. No fue posible levantar PostgreSQL: no hay servidor/cliente instalado y Docker Desktop no logró iniciar su daemon. Por ello no se ejecutaron migraciones ni pruebas funcionales.
- Se añadió la guía de ejecución local compatible con Supabase CLI; utiliza el destino local sin `supabase link` ni opciones remotas.
- Se añadió `bootstrap_first_admin`, invocable solo por el propietario de la base y de un solo uso mientras `public.usuarios` está vacío. Crea el perfil con rol Administración y registra auditoría como sistema para resolver el ciclo de identidad inicial sin habilitarlo al backend `service_role`.
- Se añadió una suite pgTAP de integridad y seguridad en `supabase/tests/database/v4_integrity.test.sql`, más escenarios manuales de concurrencia. La suite no se ejecutó porque PostgreSQL/Docker no está disponible.

## Decisiones de negocio incorporadas

- Se agregaron roles iniciales Administración, Ventas y Logística, el permiso `auditoria.consultar` reservado a Administración y la marca de destinatario del reporte diario.
- La serie ahora es una única columna `A-Z0-9`, mayúscula y única; normalizará el servidor antes de persistir.
- Los folios conservan guiones, comparan sin espacios y en mayúsculas. Se permite corrección mediante tabla histórica `folios_fisicos_reservados`, con UNIQUE global y trigger transaccional; se retiró la regla que prohibía corregir folios.
- Se sustituyeron estados de fabricación previos por `en_construccion/finalizado`; finalización registra actor/fecha y los cambios ordinarios posteriores fallan.
- Se genera V1 al crear orden; versiones consecutivas se crean con bloqueo y no se actualizan/eliminan. El RPC de corrección excepcional requiere motivo y actor.
- Evidencias quedaron en migración inicial separada; se conserva metadata y la eliminación es lógica, sin purga del objeto Storage.
- Se endureció el contexto de auditoría a usuario o sistema y no se acepta auditor nulo silencioso. Una modificación auditada también crea un resumen y destinatarios activos.
- Se documentó el horario diario fijo y el periodo anterior en `America/Monterrey`, con deduplicación por día y destinatario.
- Facturación se retiró de migraciones iniciales y se movió a un borrador SQL futuro fuera de `supabase/migrations/`; se mantiene tentativa la relación uno-a-uno.

## Archivos

- Reescritos: `modelo-er-v4.md`, `diccionario-datos.md`, `reglas-integridad.md`, `decisiones-pendientes.md`, `revision-tecnica.md`.
- Añadida: `guia-pruebas-local-supabase.md` con pasos para aplicar el conjunto inicial sin vincular a remoto.
- Añadida: `supabase/tests/database/v4_integrity.test.sql` con pruebas pgTAP de esquema, restricciones, auditoría, permisos y operaciones negativas.
- Añadido: este registro.
- Ajustados: migraciones iniciales `001` a `006`; `004_billing_evidence.sql` se reemplazó por `004_evidences.sql`.
- Añadido fuera del orden inicial: `supabase/future_migrations/202611180007_billing_external_draft.sql`.
- Se eliminaron marcadores `.gitkeep` de `docs/` y `supabase/migrations/` porque ahora contienen documentos/migraciones reales.

## Corrección del cierre de reservas de folio

- Causa: `validar_cierre_reserva_folio()` comparaba `to_jsonb(NEW)` con `to_jsonb(OLD)` en un trigger `BEFORE UPDATE`. La reserva incluye `folio_normalizado`, columna generada cuyo valor nuevo todavía no está calculado en ese punto; la comparación completa difería aunque solo cambiara `es_actual`.
- Corrección: la función de corrección de la hoja establece temporalmente `ca.folio_correction_document_id` para la reserva asociada, restaura el contexto al terminar, y el trigger valida ese documento y compara explícitamente las columnas base inmutables. Se conserva la reserva histórica y su índice UNIQUE; solo la ruta auditada de corrección puede marcar la reserva actual como histórica.
- Regresión: se comprueba que la corrección legítima pasa, que la reserva anterior permanece, que el nuevo folio queda actual y que una actualización directa `es_actual = false` se rechaza. El total de la suite pasa a 68 asertos.
- Se actualizaron las migraciones originales 002 y 005 para instalaciones nuevas y se creó `supabase/patches/202611200001_fix_folio_reservation_guard.sql` para la base de desarrollo que ya ejecutó manualmente las migraciones. El parche solo reemplaza funciones y conserva/revoca los permisos previstos; no modifica filas ni elimina objetos.
- No se ejecutó el parche ni la suite en Supabase. La aplicación del parche y la repetición de pgTAP quedan pendientes en desarrollo.

## Corrección del trigger de estados de fabricación

- El resultado reportado de 61/68 mostró accesos dinámicos a columnas ausentes: `trabajos` no tiene `cancelado_en` (sí tiene `eliminado_en`), y `ordenes_fabricacion` tiene `cancelado_en` pero no `eliminado_en`. Las condiciones combinadas con `TG_TABLE_NAME AND/OR NEW/OLD.columna` no separaban de forma segura los registros; se reemplazaron por ramas explícitas por tabla.
- `trabajos.importe` es generada. El comparador genérico de la excepción leía `to_jsonb(NEW)` antes de calcularla, haciendo fallar la finalización válida y explicando las comprobaciones de actor/auditoría dependientes de ese cambio. Ahora las columnas de negocio se comparan explícitamente por tabla, excluyendo solo estado, metadatos de finalización y `actualizado_en`; los demás datos no pueden cambiar durante la excepción.
- El flujo distingue el intento de finalizar un hijo pendiente con datos adicionales (error `Bajo una hoja finalizada no se modifican datos del hijo`) de la edición posterior de un hijo ya finalizado (error `El registro finalizado es de consulta; use la operación excepcional autorizada`). La atribución de actor y auditoría sigue obligatoria.
- Se corrigió `validar_estado_trabajo()` en la migración 005 y se preparó `supabase/patches/202611200002_fix_validar_estado_trabajo.sql` para la base existente. Las pruebas existentes ya cubren la finalización válida, los cambios combinados, la edición posterior y la auditoría; sus expectativas corresponden a las reglas aprobadas y no se cambiaron.
- El usuario reportó 61 pruebas aprobadas y 7 fallidas antes de esta corrección. El parche y las 68 pruebas posteriores no se ejecutaron; queda pendiente verificar en PostgreSQL.

## Decisiones aún abiertas

Saltos de folio digital, reactivación de cancelados, operaciones excepcionales tras finalizar, retención/restauración de objetos, modelo fiscal futuro, campos JSONB definitivos, matriz de permisos, forma de conexión PostgreSQL para contexto de actor y semántica de reintentos del proveedor de correo. Ver `decisiones-pendientes.md`. Una regla agregada para finalizar hojas puede considerarse en el futuro, pero no es una dependencia actual.

## Validación

Solo inspección estática y revisión textual; no se encontró PostgreSQL local ni parser SQL. No se conectó ni ejecutó nada en Supabase. Pendiente prueba de creación de esquema, triggers, grants y RLS en entorno local/aislado.
