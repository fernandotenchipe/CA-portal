# Guía para probar la base V4 en Supabase de desarrollo

Las seis migraciones ya fueron ejecutadas manualmente en un proyecto Supabase exclusivo de desarrollo. Esta guía prueba la suite contra ese esquema existente sin reconstruirlo, registrar un historial CLI ni volver a aplicar migraciones. No aplica a producción.

# Alcance y preparación

La suite `supabase/tests/database/v4_integrity.test.sql` abre una transacción y termina con `ROLLBACK`. Incluye escrituras de prueba, por lo que primero hay que completar el preflight de solo lectura de abajo. Las secuencias PostgreSQL no revierten sus valores y la suite toma temporalmente un lock exclusivo de `public.usuarios`.

No uses `supabase test db` para el proyecto alojado: ese comando está destinado al stack local. Tampoco ejecutes `supabase link`, `migration repair/list`, `db push`, `db reset`, ni vuelvas a aplicar las migraciones.

La suite cubre unicidad y corrección/reserva de folios, números de serie, relaciones, versiones, estados, evidencias, auditoría, permisos/RLS, notificaciones y configuración del reporte. No simula dos sesiones concurrentes; ese escenario es adicional y no forma parte de los 68 asertos pgTAP actuales.

## Ejecutar la suite contra el proyecto de desarrollo ya migrado

`supabase test db` está documentado como una prueba de la base **local**; no es el comando para ejecutar esta suite en el proyecto alojado. Como las seis migraciones se aplicaron manualmente y no hay historial CLI, no ejecutes `supabase link`, `migration repair`, `migration list`, `db push`, `db reset` ni intentes reconstruir dicho historial para probar.

La suite `v4_integrity.test.sql` ahora:

- Incluye los asertos de los triggers de destinatarios y las regresiones de corrección de folios; ahora son 68. Empieza una transacción explícita que termina en `ROLLBACK`.
- Usa una ruta de búsqueda que incluye `extensions` para pgTAP.
- Comprueba dentro de la transacción que sus UUID, correo, serie y folios fijos no estén ocupados; si detecta una colisión, falla antes de insertar fixtures.
- Maneja ambos casos del bootstrap: comprueba la creación inicial solo si no hay perfiles; si ya existen perfiles, comprueba que se rechace el bootstrap y crea su perfil temporal de prueba como actor sistema.
- Prueba la hoja con unidad inexistente usando un UUID distinto al de la unidad válida del fixture.

## Parche de reservas históricas de folios

Si la base de desarrollo tiene aplicadas las seis migraciones V4, aplica solo `supabase/patches/202611200001_fix_folio_reservation_guard.sql`. No vuelvas a aplicar la migración 005 ni ejecutes `db push` o `db reset`. Este parche reemplaza dos funciones dentro de una transacción; no borra tablas ni modifica filas existentes. Ejecútalo como propietario de la base, únicamente en el proyecto de desarrollo, y detente si falla o vence el `lock_timeout`.

Con `psql`, desde la raíz de CA-portal y usando la conexión segura al proyecto de desarrollo:

```powershell
psql -X -v ON_ERROR_STOP=1 -W `
  "host=<HOST_DEL_PROYECTO> port=<PUERTO> dbname=postgres user=<USUARIO_DB> sslmode=verify-full sslrootcert=<RUTA_CA>" `
  -f .\supabase\patches\202611200001_fix_folio_reservation_guard.sql
```

También puedes abrir ese archivo en Supabase SQL Editor, confirmar el proyecto y ejecutar su contenido completo. El parche verifica que existan el esquema y los triggers esperados antes de reemplazar funciones. Después, vuelve a ejecutar la suite `v4_integrity.test.sql`; incluye una corrección legítima exitosa y el rechazo de la desactivación directa de una reserva vigente.

## Parche del trigger de estados de fabricación

Para corregir los fallos 47–53 reportados después de ejecutar las 68 pruebas, aplica solo `supabase/patches/202611200002_fix_validar_estado_trabajo.sql` en la base de desarrollo. El parche reemplaza `validar_estado_trabajo()` dentro de una transacción; no crea triggers ni modifica datos. Ejecútalo como propietario y confirma que el proyecto seleccionado sea desarrollo.

```powershell
psql -X -v ON_ERROR_STOP=1 -W `
  "host=<HOST_DEL_PROYECTO> port=<PUERTO> dbname=postgres user=<USUARIO_DB> sslmode=verify-full sslrootcert=<RUTA_CA>" `
  -f .\supabase\patches\202611200002_fix_validar_estado_trabajo.sql
```

También puedes ejecutar el contenido completo del parche desde Supabase SQL Editor. No vuelvas a aplicar las migraciones ni el parche de folios si ya quedó aplicado. Si el parche termina con `COMMIT`, vuelve a ejecutar la suite completa de 68 asertos; no ejecutes solo las pruebas fallidas, porque comparten fixtures y estado transaccional.

### Preflight de solo lectura

Antes de la prueba, confirma el proyecto de desarrollo en el Dashboard y ejecuta estas consultas por separado. No ejecutes la suite si pgTAP no está instalado, si faltan tablas/RLS o si la consulta de colisiones devuelve alguna fila.

```sql
SELECT current_database() AS base, current_user AS rol;

SELECT e.extname, n.nspname AS esquema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pgtap';

SELECT c.relname AS tabla, c.relrowsecurity AS rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = ANY (ARRAY[
    'roles','permisos','rol_permisos','usuarios','clientes','unidades',
    'documentos_cortos','folios_fisicos_reservados','trabajos','ordenes_fabricacion',
    'versiones_fabricacion','impresiones','evidencias','auditoria','notificaciones',
    'notificacion_usuarios','reportes_diarios','reportes_diarios_destinatarios'
  ])
ORDER BY c.relname;

SELECT t.tgname AS trigger, p.proname AS funcion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;

SELECT 'auth.users' AS tabla, id::text AS fixture
FROM auth.users
WHERE id IN (
  '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'
)
   OR lower(email) IN ('ca-v4-admin@example.invalid', 'ca-v4-worker@example.invalid')
UNION ALL
SELECT 'public.usuarios', id::text FROM public.usuarios
WHERE id IN (
  '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'
)
UNION ALL
SELECT 'public.clientes', id::text FROM public.clientes
WHERE id = '20000000-0000-0000-0000-000000000001'
   OR correo = 'cliente-test@example.invalid'
UNION ALL
SELECT 'public.unidades', id::text FROM public.unidades
WHERE id BETWEEN '30000000-0000-0000-0000-000000000001'::uuid
             AND '30000000-0000-0000-0000-000000000004'::uuid
   OR numero_serie = 'SERIE123'
UNION ALL
SELECT 'public.documentos_cortos', id::text FROM public.documentos_cortos
WHERE id BETWEEN '40000000-0000-0000-0000-000000000001'::uuid
             AND '40000000-0000-0000-0000-000000000006'::uuid
   OR folio_fisico_normalizado IN (
     'FOLIO-NO-CLIENTE', 'AB-001', 'AB001', 'XY-009', 'FAB-001', 'EVID-001'
   )
UNION ALL
SELECT 'public.folios_fisicos_reservados', documento_corto_id::text
FROM public.folios_fisicos_reservados
WHERE folio_normalizado IN (
  'FOLIO-NO-CLIENTE', 'AB-001', 'AB001', 'XY-009', 'FAB-001', 'EVID-001'
)
UNION ALL
SELECT 'public.trabajos', id::text FROM public.trabajos
WHERE id = '50000000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'public.ordenes_fabricacion', id::text FROM public.ordenes_fabricacion
WHERE id = '60000000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'public.evidencias', id::text FROM public.evidencias
WHERE id = '70000000-0000-0000-0000-000000000001';
```

Confirma que `current_database()` corresponde al proyecto de desarrollo, que pgTAP aparece, que están las 18 tablas con RLS y que la consulta de colisiones devuelve cero filas. Revisa también los triggers de `auth.users`: si hay triggers no internos, determina su efecto antes de insertar fixtures de Auth. El archivo `supabase/tests/database/v4_integrity.test.sql` no crea ni elimina extensiones.

### Ejecutar por conexión directa con `psql`

Usa la conexión PostgreSQL del proyecto de desarrollo desde **Connect** en su Dashboard. No incluyas la contraseña en el comando ni la guardes en el repositorio; `-W` la solicita de forma interactiva. Ejecuta desde la raíz de `CA-portal`:

```powershell
psql -X -v ON_ERROR_STOP=1 -W `
  "host=<HOST_DEL_PROYECTO> port=<PUERTO> dbname=postgres user=<USUARIO_DB> sslmode=require" `
  -f .\supabase\tests\database\v4_integrity.test.sql
```

El comando solo envía el archivo de pruebas a la base; no aplica migraciones ni consulta el historial CLI. Debe terminar mostrando los resultados pgTAP y el `ROLLBACK` final. Si ocurre un error SQL, `ON_ERROR_STOP` detiene el archivo y `psql` cierra la conexión; PostgreSQL revierte la transacción que quedó abierta. No reintentes hasta entender el error.

Al terminar, vuelve a ejecutar la consulta de colisiones del preflight. Debe devolver cero filas. Esta comprobación es solo lectura; no intentes compensar con `DELETE` manual. Si el cliente se desconectó o no viste el `ROLLBACK`, repite primero la consulta de colisiones y detente si devuelve alguna fila.

### Efectos que el `ROLLBACK` no revierte

Las filas de `auth.users`, perfiles de prueba, documentos, reservas, trabajos, órdenes, versiones, evidencias, auditoría y notificaciones quedan dentro de la transacción y deben revertirse. Sin embargo, las secuencias PostgreSQL (`auditoria_id_seq`) no revierten los valores consumidos por `nextval()`; pueden quedar huecos normales en los IDs de auditoría. La transacción también toma un lock exclusivo de `public.usuarios` al evaluar el bootstrap. Ejecuta la suite en un horario sin operaciones concurrentes.

Si no se acepta consumir esos valores de secuencia o pausar brevemente escrituras mientras corre el lock, **no ejecutes esta suite en el proyecto que contiene datos**. Usa una base/proyecto de pruebas aislado con las seis migraciones ya aplicadas allí y fixtures desechables. No resetees ni borres las tablas del proyecto actual.

## Límites de seguridad

- No ejecutes `supabase db reset --linked`, `supabase db reset --remote`, `supabase db push` ni uses `--db-url`.
- No uses `supabase link` durante esta validación.
- No uses herramientas ni comandos con enlace remoto implícito para ejecutar migraciones.
- No guardes claves del stack local en `.env.example` ni en los archivos SQL.
- El comando de esta guía prueba el proyecto alojado de desarrollo por `psql`; `supabase test db` solo sirve para un stack local separado. La suite no prueba concurrencia real; déjala pendiente hasta preparar un proyecto aislado y dos sesiones.

Referencias oficiales: [Supabase CLI: pruebas y lint](https://supabase.com/docs/guides/local-development/cli/testing-and-linting), [pruebas de base de datos con pgTAP](https://supabase.com/docs/guides/database/testing) y [pgTAP en Supabase](https://supabase.com/docs/guides/database/extensions/pgtap).
