BEGIN;
SET LOCAL search_path = extensions, public, auth, pg_catalog;
SELECT no_plan();

-- El bootstrap positivo solo es válido cuando todavía no hay perfiles. En un
-- proyecto de desarrollo ya inicializado se prueba el rechazo del bootstrap y
-- se crea el perfil de prueba como actor sistema dentro de esta transacción.
CREATE TEMP TABLE ca_v4_bootstrap_state ON COMMIT DROP AS
SELECT EXISTS (SELECT 1 FROM public.usuarios) AS perfiles_existentes;

-- Los fixtures usan UUID/folios conocidos. Abortar antes de cualquier INSERT
-- si una ejecución previa/manual u otro uso ya ocupa alguno de ellos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
    OR lower(email) IN ('ca-v4-admin@example.invalid', 'ca-v4-worker@example.invalid')
  ) OR EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.clientes
    WHERE id = '20000000-0000-0000-0000-000000000001'
       OR correo = 'cliente-test@example.invalid'
  ) OR EXISTS (
    SELECT 1 FROM public.unidades
    WHERE id BETWEEN '30000000-0000-0000-0000-000000000001'::uuid
                 AND '30000000-0000-0000-0000-000000000004'::uuid
       OR numero_serie = 'SERIE123'
  ) OR EXISTS (
    SELECT 1 FROM public.documentos_cortos
    WHERE id BETWEEN '40000000-0000-0000-0000-000000000001'::uuid
                 AND '40000000-0000-0000-0000-000000000006'::uuid
       OR folio_fisico_normalizado IN (
         'FOLIO-NO-CLIENTE', 'AB-001', 'AB001', 'XY-009', 'FAB-001', 'EVID-001'
       )
  ) OR EXISTS (
    SELECT 1 FROM public.folios_fisicos_reservados
    WHERE folio_normalizado IN (
      'FOLIO-NO-CLIENTE', 'AB-001', 'AB001', 'XY-009', 'FAB-001', 'EVID-001'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.trabajos WHERE id = '50000000-0000-0000-0000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM public.ordenes_fabricacion WHERE id = '60000000-0000-0000-0000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM public.evidencias WHERE id = '70000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Fixture UUID, correo, serie o folio ya existe; no se ejecutaron escrituras de prueba';
  END IF;
END;
$$;

-- Fixtures Auth temporales. Todo el archivo queda dentro de la transacción
-- revertida al final; no se usa ON CONFLICT para ocultar colisiones.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'ca-v4-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'ca-v4-worker@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

SELECT CASE
  WHEN NOT (SELECT perfiles_existentes FROM pg_temp.ca_v4_bootstrap_state)
  THEN lives_ok($sql$
    SELECT public.bootstrap_first_admin(
      '10000000-0000-0000-0000-000000000001', 'CA V4 Admin Test', true)
  $sql$, 'el propietario inicializa un primer perfil de Administración')
  ELSE throws_ok($sql$
    SELECT public.bootstrap_first_admin(
      '10000000-0000-0000-0000-000000000001', 'CA V4 Admin Test', true)
  $sql$, 'P0001', 'El bootstrap solo se permite cuando todavía no hay perfiles',
    'el bootstrap se rechaza en una base que ya tiene perfiles')
END;

-- Si la base ya tenía perfiles, evita depender del bootstrap de un solo uso.
-- El trigger registra esta fixture como sistema; el ROLLBACK elimina la fila.
SET LOCAL app.actor_tipo = 'sistema';
SET LOCAL app.actor_id = '';
INSERT INTO public.usuarios (id, rol_id, nombre, activo, recibe_reporte_diario)
SELECT '10000000-0000-0000-0000-000000000001', r.id, 'CA V4 Admin Test', true, true
  FROM public.roles r
 WHERE r.codigo = 'ADMINISTRACION'
   AND (SELECT perfiles_existentes FROM pg_temp.ca_v4_bootstrap_state);

SET LOCAL app.actor_tipo = 'usuario';
SET LOCAL app.actor_id = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.usuarios (id, rol_id, nombre, activo, recibe_reporte_diario)
SELECT '10000000-0000-0000-0000-000000000002', r.id, 'CA V4 Worker Test', true, false
  FROM public.roles r WHERE r.codigo = 'VENTAS';

SET LOCAL app.actor_tipo = 'usuario';
SET LOCAL app.actor_id = '10000000-0000-0000-0000-000000000002';

SELECT ok(
  (SELECT count(*) = 18 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname = ANY (ARRAY[
        'roles','permisos','rol_permisos','usuarios','clientes','unidades',
        'documentos_cortos','folios_fisicos_reservados','trabajos','ordenes_fabricacion',
        'versiones_fabricacion','impresiones','evidencias','auditoria','notificaciones',
        'notificacion_usuarios','reportes_diarios','reportes_diarios_destinatarios'
      ])),
  'existen las 18 tablas iniciales'
);

SELECT ok((SELECT count(*) = 18 FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
    'roles','permisos','rol_permisos','usuarios','clientes','unidades',
    'documentos_cortos','folios_fisicos_reservados','trabajos','ordenes_fabricacion',
    'versiones_fabricacion','impresiones','evidencias','auditoria','notificaciones',
    'notificacion_usuarios','reportes_diarios','reportes_diarios_destinatarios'
  ]) AND c.relrowsecurity), 'RLS está habilitado en las 18 tablas');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = 'public.reportes_diarios_destinatarios'::regclass
    AND t.tgname = 'reportes_destinatarios_validar'
    AND t.tgfoid = 'public.validar_destinatario_reporte()'::regprocedure
    AND t.tgenabled = 'O' AND NOT t.tgisinternal
), 'el trigger de validación de destinatarios existe y está habilitado');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = 'public.reportes_diarios_destinatarios'::regclass
    AND t.tgname = 'reportes_destinatario_resultado_proteger'
    AND t.tgfoid = 'public.proteger_resultado_destinatario_reporte()'::regprocedure
    AND t.tgenabled = 'O' AND NOT t.tgisinternal
), 'el trigger de protección de resultado existe y está habilitado');

SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'),
  'no hay políticas RLS públicas que abran acceso directo');
SELECT ok(NOT has_table_privilege('anon', 'public.clientes', 'SELECT'),
  'anon no puede consultar tablas operativas');
SELECT ok(NOT has_table_privilege('authenticated', 'public.auditoria', 'SELECT'),
  'authenticated no puede consultar auditoría directamente');
SELECT ok(has_table_privilege('service_role', 'public.auditoria', 'SELECT'),
  'el backend puede consultar auditoría para aplicar autorización de Administración');
SELECT ok(NOT has_table_privilege('service_role', 'public.auditoria', 'INSERT'),
  'service_role no puede insertar auditoría directamente');
SELECT ok(NOT has_table_privilege('service_role', 'public.folios_fisicos_reservados', 'UPDATE'),
  'service_role no puede editar reservas históricas directamente');
SELECT ok(NOT has_table_privilege('service_role', 'public.versiones_fabricacion', 'INSERT'),
  'service_role no puede insertar versiones directamente');
SELECT ok(has_function_privilege('service_role',
  'public.crear_version_fabricacion(uuid,integer,jsonb)', 'EXECUTE'),
  'el backend puede invocar el RPC normal de versionado');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.crear_version_fabricacion(uuid,integer,jsonb)', 'EXECUTE'),
  'authenticated no puede invocar RPC de versionado');
SELECT ok(NOT has_function_privilege('service_role',
  'public.bootstrap_first_admin(uuid,text,boolean)', 'EXECUTE'),
  'el servicio de aplicación no puede usar el bootstrap de propietario');
SELECT throws_ok($sql$
  SELECT public.bootstrap_first_admin(
    '10000000-0000-0000-0000-000000000002', 'Segundo administrador', true)
$sql$, 'P0001', 'El bootstrap solo se permite cuando todavía no hay perfiles',
  'el bootstrap queda bloqueado después del primer perfil');
SELECT ok((SELECT count(*) = 1 FROM public.rol_permisos rp
  JOIN public.roles r ON r.id = rp.rol_id
  JOIN public.permisos p ON p.id = rp.permiso_id
  WHERE p.modulo = 'auditoria' AND p.operacion = 'consultar'
    AND r.codigo = 'ADMINISTRACION'),
  'el permiso de consulta de auditoría está asignado a Administración');
SELECT throws_ok($sql$
  INSERT INTO public.rol_permisos (rol_id, permiso_id)
  SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permisos p
  WHERE r.codigo = 'VENTAS' AND p.modulo = 'auditoria' AND p.operacion = 'consultar'
$sql$, 'P0001', 'Solo Administración puede recibir permisos de auditoría',
  'rechaza conceder auditoría detallada a Ventas');

SELECT ok(EXISTS (SELECT 1 FROM public.auditoria
  WHERE entidad = 'public.usuarios'
    AND entidad_id = '10000000-0000-0000-0000-000000000001'
    AND tipo_actor = 'sistema' AND usuario_id IS NULL),
  'la fixture de Administración queda auditada como sistema');

SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.unidades'::regclass AND contype = 'f'
    AND confrelid = 'public.clientes'::regclass), 'unidades tiene FK a clientes');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.documentos_cortos'::regclass AND contype = 'f'
    AND confrelid = 'public.unidades'::regclass), 'hojas tienen FK a unidades');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.trabajos'::regclass AND contype = 'f'
    AND confrelid = 'public.documentos_cortos'::regclass), 'trabajos tienen FK a hojas');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.ordenes_fabricacion'::regclass AND contype = 'f'
    AND confrelid = 'public.documentos_cortos'::regclass), 'órdenes tienen FK a hojas');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.versiones_fabricacion'::regclass AND contype = 'f'
    AND confrelid = 'public.ordenes_fabricacion'::regclass), 'versiones tienen FK a órdenes');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.evidencias'::regclass AND contype = 'f'
    AND confrelid = 'public.documentos_cortos'::regclass), 'evidencias tienen FK a hojas');

INSERT INTO public.clientes (id, nombre, correo)
VALUES ('20000000-0000-0000-0000-000000000001', 'Cliente V4 Test', 'cliente-test@example.invalid');
INSERT INTO public.unidades (id, cliente_id, numero_serie)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'SERIE123');
SELECT throws_ok($sql$
  INSERT INTO public.unidades (id, cliente_id, numero_serie)
  VALUES ('30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001', 'SERIE123')
$sql$, '23505', NULL, 'rechaza número de serie duplicado');
SELECT throws_ok($sql$
  INSERT INTO public.unidades (id, cliente_id, numero_serie)
  VALUES ('30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001', 'SER-123')
$sql$, '23514', NULL, 'rechaza serie con guion');
SELECT throws_ok($sql$
  INSERT INTO public.unidades (id, cliente_id, numero_serie)
  VALUES ('30000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001', 'SER 123')
$sql$, '23514', NULL, 'rechaza serie con espacios');
SELECT throws_ok($sql$
  INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
  VALUES ('40000000-0000-0000-0000-000000000001', 'FOLIO-NO-CLIENTE',
    '30000000-0000-0000-0000-000000000099')
$sql$, '23503', NULL, 'rechaza hoja cuya unidad no existe');

INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
VALUES ('40000000-0000-0000-0000-000000000001', 'AB-001', '30000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
  VALUES ('40000000-0000-0000-0000-000000000002', 'AB001',
    '30000000-0000-0000-0000-000000000001')
$sql$, 'el guion distingue AB-001 de AB001');
SELECT throws_ok($sql$
  INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
  VALUES ('40000000-0000-0000-0000-000000000003', 'ab - 001',
    '30000000-0000-0000-0000-000000000001')
$sql$, '23505', NULL, 'mayúsculas y espacios no distinguen un folio ya usado');

SELECT lives_ok($sql$
  UPDATE public.documentos_cortos SET folio_fisico = 'XY-009'
  WHERE id = '40000000-0000-0000-0000-000000000001'
$sql$, 'una corrección legítima actualiza el folio y conserva su reserva histórica');
SELECT is((SELECT count(*)::integer FROM public.folios_fisicos_reservados
  WHERE documento_corto_id = '40000000-0000-0000-0000-000000000001'),
  2, 'la corrección conserva ambas reservas');
SELECT ok(EXISTS (SELECT 1 FROM public.folios_fisicos_reservados
  WHERE documento_corto_id = '40000000-0000-0000-0000-000000000001'
    AND folio_normalizado = 'AB-001' AND NOT es_actual),
  'el folio anterior queda reservado como histórico');
SELECT ok(EXISTS (SELECT 1 FROM public.folios_fisicos_reservados
  WHERE documento_corto_id = '40000000-0000-0000-0000-000000000001'
    AND folio_normalizado = 'XY-009' AND es_actual),
  'el folio corregido queda como reserva actual');
SELECT throws_ok($sql$
  UPDATE public.folios_fisicos_reservados SET es_actual = false
  WHERE documento_corto_id = '40000000-0000-0000-0000-000000000001'
    AND es_actual
$sql$, 'P0001', 'Una reserva de folio solo puede dejar de ser actual durante una corrección',
  'no se puede desactivar directamente la reserva vigente');
SELECT throws_ok($sql$
  INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
  VALUES ('40000000-0000-0000-0000-000000000004', 'AB-001',
    '30000000-0000-0000-0000-000000000001')
$sql$, '23505', NULL, 'el folio histórico no se puede reasignar');
SELECT throws_ok($sql$
  UPDATE public.folios_fisicos_reservados SET es_actual = true
  WHERE documento_corto_id = '40000000-0000-0000-0000-000000000001'
    AND folio_normalizado = 'AB-001'
$sql$, 'P0001', 'Una reserva de folio solo puede dejar de ser actual durante una corrección',
  'no se puede reactivar directamente una reserva histórica');

INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
VALUES ('40000000-0000-0000-0000-000000000005', 'FAB-001', '30000000-0000-0000-0000-000000000001');
INSERT INTO public.trabajos (id, documento_corto_id, numero_orden, descripcion)
VALUES ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005',
  1, 'Trabajo de prueba');
INSERT INTO public.ordenes_fabricacion (id, documento_corto_id)
VALUES ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005');
SELECT is((SELECT count(*)::integer FROM public.versiones_fabricacion
  WHERE orden_fabricacion_id = '60000000-0000-0000-0000-000000000001'),
  1, 'crear orden genera versión inicial V1');
SELECT throws_ok($sql$
  UPDATE public.trabajos SET estado = 'en_progreso'
  WHERE id = '50000000-0000-0000-0000-000000000001'
$sql$, '23514', NULL, 'no introduce estados de producción no aprobados');
SELECT lives_ok($sql$
  SELECT public.crear_version_fabricacion(
    '60000000-0000-0000-0000-000000000001', 1, '{"tipo_carroceria":"caja"}'::jsonb)
$sql$, 'RPC crea la siguiente versión');
SELECT is((SELECT max(numero_version)::integer FROM public.versiones_fabricacion
  WHERE orden_fabricacion_id = '60000000-0000-0000-0000-000000000001'),
  2, 'la versión nueva es consecutiva');
SELECT throws_ok($sql$
  UPDATE public.versiones_fabricacion SET especificaciones = '{"editada":true}'::jsonb
  WHERE orden_fabricacion_id = '60000000-0000-0000-0000-000000000001'
    AND numero_version = 1
$sql$, 'P0001', 'Las versiones de fabricación son inmutables; cree una versión nueva',
  'rechaza cambiar una versión previa');
SELECT throws_ok($sql$
  DELETE FROM public.versiones_fabricacion
  WHERE orden_fabricacion_id = '60000000-0000-0000-0000-000000000001'
    AND numero_version = 1
$sql$, 'P0001', 'Las versiones de fabricación son inmutables; cree una versión nueva',
  'rechaza borrar una versión previa');

SELECT lives_ok($sql$
  UPDATE public.documentos_cortos SET estado_trabajo = 'finalizado'
  WHERE id = '40000000-0000-0000-0000-000000000005'
$sql$, 'la hoja se finaliza aunque trabajo y orden sigan en construcción');
SELECT throws_ok($sql$
  UPDATE public.trabajos SET estado = 'finalizado', descripcion = 'Cambio no permitido'
  WHERE id = '50000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'Bajo una hoja finalizada no se modifican datos del hijo',
  'bajo hoja finalizada rechaza finalizar junto con cambio de descripción');
SELECT lives_ok($sql$
  UPDATE public.trabajos SET estado = 'finalizado'
  WHERE id = '50000000-0000-0000-0000-000000000001'
$sql$, 'permite completar solo el estado del trabajo pendiente');
SELECT ok((SELECT finalizado_por = '10000000-0000-0000-0000-000000000002'
  AND finalizado_en IS NOT NULL FROM public.trabajos
  WHERE id = '50000000-0000-0000-0000-000000000001'),
  'finalización del trabajo atribuye usuario y hora');
SELECT throws_ok($sql$
  UPDATE public.ordenes_fabricacion SET estado = 'finalizado', fecha_estimada_inicio = DATE '2027-01-01'
  WHERE id = '60000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'Bajo una hoja finalizada no se modifican datos del hijo',
  'bajo hoja finalizada rechaza finalizar orden junto con cambio de datos');
SELECT lives_ok($sql$
  UPDATE public.ordenes_fabricacion SET estado = 'finalizado'
  WHERE id = '60000000-0000-0000-0000-000000000001'
$sql$, 'permite completar solo el estado de la orden pendiente');
SELECT throws_ok($sql$
  UPDATE public.ordenes_fabricacion SET fecha_estimada_inicio = DATE '2027-01-01'
  WHERE id = '60000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'El registro finalizado es de consulta; use la operación excepcional autorizada',
  'rechaza editar datos de una orden finalizada');
SELECT throws_ok($sql$
  UPDATE public.trabajos SET descripcion = 'Edición posterior'
  WHERE id = '50000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'El registro finalizado es de consulta; use la operación excepcional autorizada',
  'rechaza editar datos de un trabajo finalizado');
SELECT ok(EXISTS (SELECT 1 FROM public.auditoria
  WHERE entidad = 'public.trabajos'
    AND entidad_id = '50000000-0000-0000-0000-000000000001'
    AND usuario_id = '10000000-0000-0000-0000-000000000002'
    AND valores_nuevos ->> 'estado' = 'finalizado'),
  'la transición excepcional del hijo queda atribuida en auditoría');

INSERT INTO public.documentos_cortos (id, folio_fisico, unidad_id)
VALUES ('40000000-0000-0000-0000-000000000006', 'EVID-001', '30000000-0000-0000-0000-000000000001');
INSERT INTO public.evidencias (id, documento_corto_id, ruta_storage, nombre_archivo, subida_por)
VALUES ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006',
  'evidencias/test/foto-1.jpg', 'foto-1.jpg', '10000000-0000-0000-0000-000000000002');
UPDATE public.evidencias SET eliminada_en = now()
WHERE id = '70000000-0000-0000-0000-000000000001';
SELECT ok((SELECT eliminada_por = '10000000-0000-0000-0000-000000000002'
  AND eliminada_en IS NOT NULL FROM public.evidencias
  WHERE id = '70000000-0000-0000-0000-000000000001'),
  'baja lógica asigna usuario y fecha');
SELECT throws_ok($sql$
  UPDATE public.evidencias SET nombre_archivo = 'reemplazo.jpg'
  WHERE id = '70000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'Los metadatos originales de una evidencia son inmutables',
  'rechaza editar metadatos de evidencia eliminada');
SELECT throws_ok($sql$
  DELETE FROM public.evidencias WHERE id = '70000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'El registro es histórico; use su mecanismo de cancelación o eliminación lógica',
  'rechaza borrar físicamente una evidencia');
SELECT throws_ok($sql$
  INSERT INTO public.evidencias (documento_corto_id, ruta_storage, nombre_archivo, subida_por)
  VALUES ('40000000-0000-0000-0000-000000000005', 'evidencias/test/bloqueada.jpg',
    'bloqueada.jpg', '10000000-0000-0000-0000-000000000002')
$sql$, 'P0001', 'Las evidencias solo se agregan o eliminan mientras la hoja está en construcción',
  'rechaza evidencia bajo hoja finalizada');

UPDATE public.clientes SET nombre = 'Cliente V4 PRIVADO'
WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT ok(EXISTS (SELECT 1 FROM public.auditoria
  WHERE entidad = 'public.clientes'
    AND entidad_id = '20000000-0000-0000-0000-000000000001'
    AND usuario_id = '10000000-0000-0000-0000-000000000002'
    AND valores_anteriores ->> 'nombre' = 'Cliente V4 Test'
    AND valores_nuevos ->> 'nombre' = 'Cliente V4 PRIVADO'),
  'auditoría captura actor y valores anteriores/nuevos');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.notificaciones n
  JOIN public.auditoria a ON a.id = n.auditoria_id
  WHERE a.entidad = 'public.clientes'
    AND a.entidad_id = '20000000-0000-0000-0000-000000000001'
    AND n.mensaje LIKE '%PRIVADO%'),
  'las notificaciones no exponen valores sensibles del registro');
SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'notificaciones'
    AND column_name IN ('valores_anteriores', 'valores_nuevos')),
  'la tabla de avisos no contiene snapshots del historial');
SET LOCAL app.actor_tipo = '';
SET LOCAL app.actor_id = '';
SELECT throws_ok($sql$
  UPDATE public.clientes SET nombre = 'Cambio sin actor'
  WHERE id = '20000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'Falta un contexto de actor válido para auditar la operación',
  'rechaza mutación sin identidad de actor');
SET LOCAL app.actor_tipo = 'usuario';
SET LOCAL app.actor_id = '10000000-0000-0000-0000-000000000002';
SELECT throws_ok($sql$
  UPDATE public.auditoria SET entidad = 'alterada'
  WHERE entidad = 'public.clientes'
    AND entidad_id = '20000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'La auditoría no puede actualizarse ni eliminarse',
  'rechaza editar el historial de auditoría');
SELECT throws_ok($sql$
  DELETE FROM public.auditoria
  WHERE entidad = 'public.clientes'
    AND entidad_id = '20000000-0000-0000-0000-000000000001'
$sql$, 'P0001', 'La auditoría no puede actualizarse ni eliminarse',
  'rechaza borrar el historial de auditoría');

SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.unidades'::regclass AND contype = 'u'
    AND conname = 'unidades_numero_serie_uq'), 'serie tiene unicidad global');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.folios_fisicos_reservados'::regclass AND contype = 'u'
    AND conname = 'folios_reservados_normalizado_uq'), 'folios reservados tienen unicidad global');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.reportes_diarios'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%America/Monterrey%'),
  'reporte diario fija su zona horaria');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.reportes_diarios'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%08:00%'),
  'reporte diario fija su hora de envío');
SELECT ok(to_regclass('public.facturas_externas') IS NULL,
  'la tabla de facturación futura no forma parte del esquema inicial');

SELECT * FROM finish();
ROLLBACK;
