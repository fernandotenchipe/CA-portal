-- Diagnóstico previo para v4_integrity.test.sql.
-- Exclusivamente SELECT: no crea objetos, no modifica filas y no ejecuta pgTAP.
-- Ejecutar solo contra el proyecto Supabase de desarrollo.

WITH uuid_fixtures (valor, tabla_objetivo, campo, nota) AS (
  VALUES
    ('10000000-0000-0000-0000-000000000001'::uuid, 'auth.users', 'id', 'admin de prueba'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'auth.users', 'id', 'trabajador de prueba'),
    ('10000000-0000-0000-0000-000000000001'::uuid, 'public.usuarios', 'id', 'perfil admin de prueba'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'public.usuarios', 'id', 'perfil trabajador de prueba'),
    ('20000000-0000-0000-0000-000000000001'::uuid, 'public.clientes', 'id', 'cliente de prueba'),
    ('30000000-0000-0000-0000-000000000001'::uuid, 'public.unidades', 'id', 'unidad válida de prueba'),
    ('30000000-0000-0000-0000-000000000002'::uuid, 'public.unidades', 'id', 'unidad para serie duplicada'),
    ('30000000-0000-0000-0000-000000000003'::uuid, 'public.unidades', 'id', 'unidad para serie con guion'),
    ('30000000-0000-0000-0000-000000000004'::uuid, 'public.unidades', 'id', 'unidad para serie con espacios'),
    ('30000000-0000-0000-0000-000000000099'::uuid, 'public.unidades', 'id', 'debe seguir inexistente para probar FK inválida'),
    ('40000000-0000-0000-0000-000000000001'::uuid, 'public.documentos_cortos', 'id', 'hoja para folio corregible'),
    ('40000000-0000-0000-0000-000000000002'::uuid, 'public.documentos_cortos', 'id', 'hoja para folio AB001'),
    ('40000000-0000-0000-0000-000000000003'::uuid, 'public.documentos_cortos', 'id', 'intento de folio duplicado normalizado'),
    ('40000000-0000-0000-0000-000000000004'::uuid, 'public.documentos_cortos', 'id', 'intento de reutilizar folio histórico'),
    ('40000000-0000-0000-0000-000000000005'::uuid, 'public.documentos_cortos', 'id', 'hoja para fabricación'),
    ('40000000-0000-0000-0000-000000000006'::uuid, 'public.documentos_cortos', 'id', 'hoja para evidencia'),
    ('50000000-0000-0000-0000-000000000001'::uuid, 'public.trabajos', 'id', 'trabajo de prueba'),
    ('60000000-0000-0000-0000-000000000001'::uuid, 'public.ordenes_fabricacion', 'id', 'orden de prueba'),
    ('70000000-0000-0000-0000-000000000001'::uuid, 'public.evidencias', 'id', 'evidencia de prueba')
), email_fixtures (valor, tabla_objetivo, campo, nota) AS (
  VALUES
    ('ca-v4-admin@example.invalid', 'auth.users', 'email', 'admin de prueba'),
    ('ca-v4-worker@example.invalid', 'auth.users', 'email', 'trabajador de prueba'),
    ('cliente-test@example.invalid', 'public.clientes', 'correo', 'cliente de prueba')
), serie_fixtures (valor, nota) AS (
  VALUES
    ('SERIE123', 'serie válida de prueba'),
    ('SER-123', 'serie inválida de prueba con guion'),
    ('SER 123', 'serie inválida de prueba con espacios')
), folio_fixtures (valor) AS (
  VALUES
    ('FOLIO-NO-CLIENTE'),
    ('AB-001'),
    ('AB001'),
    ('ab - 001'),
    ('XY-009'),
    ('FAB-001'),
    ('EVID-001')
), colisiones AS (
  SELECT 'UUID'::text AS tipo, f.valor::text AS valor_consultado,
         f.tabla_objetivo AS tabla, u.id::text AS registro_existente,
         f.campo || ' (' || f.nota || ')' AS detalle
    FROM uuid_fixtures f JOIN auth.users u ON u.id = f.valor
   WHERE f.tabla_objetivo = 'auth.users'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, u.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.usuarios u ON u.id = f.valor
   WHERE f.tabla_objetivo = 'public.usuarios'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, c.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.clientes c ON c.id = f.valor
   WHERE f.tabla_objetivo = 'public.clientes'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, u.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.unidades u ON u.id = f.valor
   WHERE f.tabla_objetivo = 'public.unidades'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, d.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.documentos_cortos d ON d.id = f.valor
   WHERE f.tabla_objetivo = 'public.documentos_cortos'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, t.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.trabajos t ON t.id = f.valor
   WHERE f.tabla_objetivo = 'public.trabajos'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, o.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.ordenes_fabricacion o ON o.id = f.valor
   WHERE f.tabla_objetivo = 'public.ordenes_fabricacion'
  UNION ALL
  SELECT 'UUID', f.valor::text, f.tabla_objetivo, e.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM uuid_fixtures f JOIN public.evidencias e ON e.id = f.valor
   WHERE f.tabla_objetivo = 'public.evidencias'
  UNION ALL
  SELECT 'CORREO', f.valor, f.tabla_objetivo, u.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM email_fixtures f JOIN auth.users u ON lower(u.email) = lower(f.valor)
   WHERE f.tabla_objetivo = 'auth.users'
  UNION ALL
  SELECT 'CORREO', f.valor, f.tabla_objetivo, c.id::text,
         f.campo || ' (' || f.nota || ')'
    FROM email_fixtures f JOIN public.clientes c ON lower(c.correo) = lower(f.valor)
   WHERE f.tabla_objetivo = 'public.clientes'
  UNION ALL
  SELECT 'SERIE', f.valor, 'public.unidades', u.id::text, f.nota
    FROM serie_fixtures f JOIN public.unidades u ON u.numero_serie = f.valor
  UNION ALL
  SELECT 'FOLIO', f.valor, 'public.documentos_cortos', d.id::text,
         'folio físico normalizado: ' || d.folio_fisico
    FROM folio_fixtures f
    JOIN public.documentos_cortos d
      ON d.folio_fisico_normalizado =
         upper(regexp_replace(btrim(f.valor), '[[:space:]]+', '', 'g'))
  UNION ALL
  SELECT 'FOLIO', f.valor, 'public.folios_fisicos_reservados', r.documento_corto_id::text,
         'reserva normalizada: ' || r.folio_capturado
    FROM folio_fixtures f
    JOIN public.folios_fisicos_reservados r
      ON r.folio_normalizado =
         upper(regexp_replace(btrim(f.valor), '[[:space:]]+', '', 'g'))
)
SELECT current_database() AS base, current_user AS rol,
       'COLISIÓN'::text AS resultado, tipo, valor_consultado, tabla,
       registro_existente, detalle
  FROM colisiones
UNION ALL
SELECT current_database(), current_user, 'SIN COLISIONES', NULL, NULL, NULL, NULL,
       'Ninguno de los valores de prueba aparece en sus tablas objetivo.'
 WHERE NOT EXISTS (SELECT 1 FROM colisiones)
ORDER BY resultado DESC, tipo, valor_consultado, tabla, registro_existente;
