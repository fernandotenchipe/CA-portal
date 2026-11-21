# Diagnóstico y recuperación de intentos manuales de migración

Este procedimiento aplica porque ya pudo haber SQL ejecutado manualmente en un proyecto Supabase. **No vuelvas a ejecutar las seis migraciones, `db reset`, `DROP`, `TRUNCATE` ni borres filas del historial hasta determinar el estado real.** Las consultas de esta guía son de solo lectura; no se han ejecutado contra un proyecto remoto.

## 1. Inspección de solo lectura

Ejecuta estas consultas en el SQL Editor del proyecto correcto, primero confirmando manualmente el nombre y la referencia del proyecto. No incluyas claves ni resultados con datos de negocio al compartir el diagnóstico.

### Tablas esperadas

```sql
WITH esperadas(nombre) AS (
  VALUES
    ('roles'), ('permisos'), ('rol_permisos'), ('usuarios'),
    ('clientes'), ('unidades'), ('documentos_cortos'),
    ('folios_fisicos_reservados'), ('trabajos'), ('ordenes_fabricacion'),
    ('versiones_fabricacion'), ('impresiones'), ('evidencias'),
    ('auditoria'), ('notificaciones'), ('notificacion_usuarios'),
    ('reportes_diarios'), ('reportes_diarios_destinatarios')
)
SELECT e.nombre,
       to_regclass(format('public.%I', e.nombre)) IS NOT NULL AS existe
FROM esperadas e
ORDER BY e.nombre;
```

### Columnas y restricciones de las tablas de reportes

Esta consulta ayuda a distinguir una tabla completa de una tabla creada solo parcialmente:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('reportes_diarios', 'reportes_diarios_destinatarios')
ORDER BY table_name, ordinal_position;

SELECT tc.table_name, tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints AS tc
WHERE tc.constraint_schema = 'public'
  AND tc.table_name IN ('reportes_diarios', 'reportes_diarios_destinatarios')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
```

### Funciones de reportes y triggers asociados

```sql
WITH esperadas(nombre) AS (
  VALUES
    ('validar_destinatario_reporte'),
    ('proteger_resultado_destinatario_reporte')
)
SELECT e.nombre,
       p.oid::regprocedure AS firma,
       pg_get_functiondef(p.oid) IS NOT NULL AS definicion_disponible
FROM esperadas e
LEFT JOIN pg_proc p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = e.nombre
ORDER BY e.nombre, firma;

WITH esperados(nombre, tabla, funcion) AS (
  VALUES
    ('reportes_destinatarios_validar', 'reportes_diarios_destinatarios', 'validar_destinatario_reporte'),
    ('reportes_destinatario_resultado_proteger', 'reportes_diarios_destinatarios', 'proteger_resultado_destinatario_reporte')
)
SELECT e.nombre AS trigger_esperado,
       e.tabla AS tabla_esperada,
       t.tgname AS trigger_encontrado,
       c.relname AS tabla_encontrada,
       p.proname AS funcion_encontrada,
       t.tgenabled AS habilitado
FROM esperados e
LEFT JOIN pg_class c
  ON c.oid = to_regclass(format('public.%I', e.tabla))
LEFT JOIN pg_trigger t
  ON t.tgrelid = c.oid
 AND t.tgname = e.nombre
 AND NOT t.tgisinternal
LEFT JOIN pg_proc p ON p.oid = t.tgfoid
ORDER BY e.nombre;
```

`trigger_encontrado IS NULL` indica que ese trigger no aparece sobre la tabla esperada. `habilitado` normalmente debe ser `O` (habilitado siempre). Las consultas de catálogo no ejecutan la función ni prueban su comportamiento.

Para revisar los demás triggers instalados en las 18 tablas:

```sql
SELECT c.relname AS tabla,
       t.tgname AS trigger,
       p.oid::regprocedure AS funcion,
       t.tgenabled AS habilitado
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

### Historial del CLI, si existe

Primero comprueba la existencia del registro de migraciones:

```sql
SELECT to_regclass('supabase_migrations.schema_migrations') AS tabla_historial;
```

Solo si devuelve `supabase_migrations.schema_migrations`, ejecuta:

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '202611180001', '202611180002', '202611180003',
  '202611180004', '202611180005', '202611180006'
)
ORDER BY version;
```

El historial del CLI no demuestra por sí solo que todos los objetos estén presentes. Si el SQL se ejecutó desde el editor y no mediante el CLI, puede no haber una fila de migración correspondiente.

## 2. Recuperación segura, sin borrar datos

1. Guarda los resultados de las consultas anteriores y confirma el proyecto y entorno. Si contiene datos que deban conservarse, genera/verifica un respaldo antes de cualquier reparación.
2. No repitas `202611180005` completo si alguna de sus tablas u objetos ya existe: contiene DDL que no es idempotente y puede detenerse por objetos duplicados. No intentes resolverlo borrando tablas o historial.
3. Compara tablas, columnas, restricciones, funciones y triggers existentes con la migración corregida y con `001`–`004`. Si el estado está incompleto, prepara una reparación **hacia adelante** con solo los objetos faltantes, dentro de una transacción y sin borrar filas. La sentencia concreta depende de lo que arrojen los diagnósticos.
4. Si no existe ningún objeto de la migración `005`, no hay registro de ella y las dependencias `001`–`004` están completas, se puede planear su aplicación corregida. Antes de ejecutarla, valida el destino y realiza una revisión final del SQL; no se hizo aquí.
5. Si todos los objetos de `005` existen pero falta su fila del historial, primero valida la estructura completa y los datos. Solo entonces evalúa reconciliar el historial del CLI; no marques como aplicada una migración que tenga objetos faltantes.
6. Si el historial dice que `005` está aplicada pero faltan objetos, conserva ese historial y crea una migración correctiva nueva después de revisar el estado. No edites el historial ni vuelvas a ejecutar `005`.
7. Ejecuta pruebas funcionales en un proyecto aislado de desarrollo después de recuperar consistencia. Mantén fuera el borrador `202611180007_billing_external_draft.sql`.

No se recomienda decidir cuál de estas rutas aplica hasta recibir los resultados de diagnóstico. No se ha recomendado ni ejecutado SQL remoto.
