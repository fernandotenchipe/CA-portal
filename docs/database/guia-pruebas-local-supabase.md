# Guía para ejecutar las migraciones en Supabase local

Esta guía aplica las seis migraciones iniciales del portal a una instancia local desechable de Supabase. No requiere ni debe vincularse a un proyecto alojado. `supabase/future_migrations/` queda fuera del orden que procesa el CLI.

## Requisitos

- Docker Desktop instalado y con el motor iniciado.
- Node.js y npm disponibles para invocar el CLI con `npx`.
- Espacio en disco para descargar las imágenes locales de Supabase.

Las migraciones requieren el esquema y roles que prepara Supabase local, incluidos `auth.users`, `anon`, `authenticated` y `service_role`. No se recomienda aplicarlas a un PostgreSQL vacío sin preparar antes esos elementos.

## Inicializar la configuración local

Abre PowerShell en la raíz de `CA-portal`:

```powershell
Set-Location 'C:\ruta\a\CA-portal'
npx supabase --version
```

Si `supabase/config.toml` aún no existe, crea la configuración local:

```powershell
npx supabase init
```

Revisa el archivo generado y sus puertos. No ejecutes `supabase link` ni agregues credenciales de un proyecto alojado.

## Iniciar y aplicar las seis migraciones

Confirma primero que Docker Desktop indique que el motor está activo. Después, desde la raíz del proyecto:

```powershell
npx supabase start
npx supabase db reset
```

No vincules el directorio a un proyecto remoto. El CLI actual opera sobre el stack local por defecto si no se pasa `--remote`; `db reset` vuelve a crear la base local y aplica, en orden, los archivos de `supabase/migrations/`. Es destructivo únicamente para esa base local; borra sus datos de prueba anteriores. La terminal debe mostrar las seis migraciones iniciales como aplicadas:

1. `202611180001_core.sql`
2. `202611180002_documents.sql`
3. `202611180003_fabrication.sql`
4. `202611180004_evidences.sql`
5. `202611180005_audit_notifications_reports.sql`
6. `202611180006_rls_baseline.sql`

El borrador `supabase/future_migrations/202611180007_billing_external_draft.sql` no está bajo `supabase/migrations/` y no debe aplicarse en esta prueba.

## Ejecutar las pruebas pgTAP

La suite `supabase/tests/database/v4_integrity.test.sql` crea sus identidades y datos de prueba dentro de su propia transacción y termina con `ROLLBACK`. Ejecuta:

```powershell
npx supabase test db
```

La suite cubre catálogo de tablas, relaciones, unicidad de serie/folio, diferencias entre guiones, corrección y reserva histórica, versionado, finalización de hijos bajo hoja finalizada, baja lógica de evidencias, atribución de auditoría, acceso/privilegios y configuración del reporte diario. También incluye operaciones negativas. Supabase CLI ejecuta pgTAP contra el stack local; cada archivo de test se revierte al terminar.

La suite no simula dos sesiones concurrentes. Para verificarlo, crea en el Auth local un usuario confirmado, ejecuta el bootstrap de Administración de abajo y crea este fixture desde una conexión SQL local. Sustituye los UUID por valores nuevos:

```sql
BEGIN;
SET LOCAL app.actor_tipo = 'usuario';
SET LOCAL app.actor_id = '<UUID_ADMIN_LOCAL>';
INSERT INTO public.clientes (id, nombre)
VALUES ('<UUID_CLIENTE>', 'CA concurrencia');
INSERT INTO public.unidades (id, cliente_id, numero_serie)
VALUES ('<UUID_UNIDAD>', '<UUID_CLIENTE>', 'RACEUNIT001');
INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
VALUES ('<UUID_HOJA>', 'RACE-VERSION-SEED', '<UUID_UNIDAD>');
INSERT INTO public.ordenes_fabricacion (id, documento_corto_id)
VALUES ('<UUID_ORDEN>', '<UUID_HOJA>');
COMMIT;
```

Abre dos conexiones independientes con `psql` o DBeaver al puerto PostgreSQL que muestre `supabase status`.

### Reserva de folio simultánea

En sesión A, empieza una transacción, fija el contexto al mismo usuario de prueba, inserta una hoja con un folio nuevo y espera antes del commit:

```sql
BEGIN;
SET LOCAL app.actor_tipo = 'usuario';
SET LOCAL app.actor_id = '<UUID_USUARIO_PRUEBA>';
INSERT INTO public.documentos_cortos (folio_fisico, unidad_id)
VALUES ('RACE-CA-001', '<UUID_UNIDAD_PRUEBA>');
SELECT pg_sleep(8);
COMMIT;
```

Mientras A espera, ejecuta la misma transacción en sesión B con el mismo folio (se puede cambiar el `pg_sleep` por `ROLLBACK` al final). B debe esperar por el índice único y fallar con `23505` cuando A confirme; luego ejecuta `ROLLBACK` en B y comprueba que solo una hoja y una reserva para `RACE-CA-001` existen. No reutilices el folio de prueba.

### Versionado simultáneo

En sesión A, bloquea la fila de la hoja asociada a la orden, espera y genera una versión dentro de la transacción:

```sql
BEGIN;
SET LOCAL app.actor_tipo = 'usuario';
SET LOCAL app.actor_id = '<UUID_USUARIO_PRUEBA>';
SELECT id FROM public.documentos_cortos
WHERE id = '<UUID_HOJA_CONSTRUCCION>' FOR UPDATE;
SELECT pg_sleep(8);
SELECT public.crear_version_fabricacion(
  '<UUID_ORDEN_CONSTRUCCION>', 1, '{"prueba":"A"}'::jsonb);
COMMIT;
```

Mientras A espera, en sesión B ejecuta `BEGIN`, establece el mismo contexto de usuario, llama `crear_version_fabricacion` sobre la misma orden con otro JSON y confirma. B debe esperar el lock de la hoja; ambas llamadas deben terminar con números de versión distintos y consecutivos, sin duplicados. Esta verificación depende de dos conexiones reales y debe reportarse por separado de pgTAP.

## Inicialización segura del primer administrador

En el Auth local crea y confirma una identidad de prueba/administrador (no insertes manualmente una fila de Auth). Copia su UUID y ejecuta en el SQL Editor local, conectado como propietario de la base:

```sql
BEGIN;
SELECT public.bootstrap_first_admin('<UUID_CREADO_EN_AUTH>'::uuid, 'Administrador inicial', true);
COMMIT;
```

La función verifica que el perfil Auth exista y que todavía no haya perfiles de aplicación; no se concede a `service_role`, `anon` ni `authenticated`. Debe devolver el UUID y generar auditoría con `tipo_actor='sistema'`, `usuario_id IS NULL`, entidad `public.usuarios` y el UUID del nuevo perfil. Usa este camino solo para bootstrap administrativo controlado; altas posteriores deben atribuirse a un usuario existente y autorizado.

## Si Docker local no está disponible

La alternativa es un proyecto Supabase **nuevo, exclusivo de desarrollo y desechable**, sin datos reales ni uso productivo. Crea el proyecto en el Dashboard y conserva su referencia; no lo conectes desde este checkout todavía.

Antes de `supabase link`, de ejecutar migraciones remotas o de correr pruebas remotas, detente y solicita autorización para ese proyecto concreto. Solo después de esa autorización, y con el ref confirmado como desarrollo, el procedimiento sería:

```powershell
npx supabase link --project-ref '<DEV_PROJECT_REF>'
npx supabase migration list --remote
npx supabase db push --dry-run --remote
```

Comprueba que el destino mostrado sea exactamente el proyecto desechable de desarrollo y que la lista contenga solo las seis migraciones aprobadas. La aplicación real requiere autorización explícita para ese paso:

```powershell
npx supabase db push --remote
npx supabase test db --remote
```

No uses `db reset --remote` en un proyecto alojado; borra datos del destino. Las pruebas remotas pueden habilitar y retirar la extensión pgTAP, por lo que se reservan al proyecto descartable y también requieren autorización.

## Confirmar el entorno y el resultado

```powershell
npx supabase status
npx supabase migration list
```

Verifica que el estado indique los servicios locales y que el historial local contenga las seis versiones esperadas. El CLI actual lista el stack local por defecto si el directorio no está vinculado. También se puede abrir Supabase Studio local usando la URL que imprime `supabase status` y revisar ahí las tablas y constraints.

Para cerrar los servicios locales:

```powershell
npx supabase stop
```

## Límites de seguridad

- No ejecutes `supabase db reset --linked`, `supabase db reset --remote`, `supabase db push` ni uses `--db-url`.
- No uses `supabase link` durante esta validación.
- Antes de cualquier comando de base de datos, comprueba que Docker y el stack local están activos con `supabase status`. En versiones del CLI que admitan `--local`, se puede usar ese flag explícito; evita `--remote` y `--db-url`.
- No guardes claves del stack local en `.env.example` ni en los archivos SQL.
- Para obtener evidencia funcional, ejecuta la suite con `supabase test db` y completa por separado los escenarios de dos sesiones de concurrencia. La guía y los archivos de prueba no demuestran por sí solos que el motor acepte las migraciones.

Referencias oficiales: [Supabase CLI: inicio local](https://supabase.com/docs/guides/local-development/cli/getting-started), [flujo local del CLI](https://supabase.com/docs/guides/local-development/cli-workflows) y [referencia de `supabase db reset`](https://supabase.com/docs/reference/cli/supabase-db-reset).
