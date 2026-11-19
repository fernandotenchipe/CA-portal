# Registro de cambios de consolidación V4

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

## Decisiones aún abiertas

Saltos de folio digital, reactivación de cancelados, operaciones excepcionales tras finalizar, retención/restauración de objetos, modelo fiscal futuro, campos JSONB definitivos, matriz de permisos, forma de conexión PostgreSQL para contexto de actor y semántica de reintentos del proveedor de correo. Ver `decisiones-pendientes.md`. Una regla agregada para finalizar hojas puede considerarse en el futuro, pero no es una dependencia actual.

## Validación

Solo inspección estática y revisión textual; no se encontró PostgreSQL local ni parser SQL. No se conectó ni ejecutó nada en Supabase. Pendiente prueba de creación de esquema, triggers, grants y RLS en entorno local/aislado.
