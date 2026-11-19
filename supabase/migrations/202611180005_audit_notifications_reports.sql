-- Auditoría obligatoria, notificaciones persistentes y ejecuciones de correo diario.

CREATE TABLE public.auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo_actor text NOT NULL CHECK (tipo_actor IN ('usuario', 'sistema')),
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  operacion text NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'CANCEL', 'DELETE')),
  entidad text NOT NULL,
  entidad_id text NOT NULL,
  valores_anteriores jsonb,
  valores_nuevos jsonb,
  correlacion_id uuid,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditoria_actor_coherente CHECK (
    (tipo_actor = 'usuario' AND usuario_id IS NOT NULL)
    OR (tipo_actor = 'sistema' AND usuario_id IS NULL)
  )
);

CREATE INDEX auditoria_entidad_registrado_idx
  ON public.auditoria (entidad, entidad_id, registrado_en DESC);
CREATE INDEX auditoria_usuario_registrado_idx
  ON public.auditoria (usuario_id, registrado_en DESC);

CREATE OR REPLACE FUNCTION public.registrar_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  row_id text;
  actor_kind text;
  actor_user uuid;
  correlation text;
  action_name text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_row := to_jsonb(OLD) - ARRAY['password', 'access_token', 'refresh_token', 'token', 'secret'];
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_row := to_jsonb(NEW) - ARRAY['password', 'access_token', 'refresh_token', 'token', 'secret'];
  END IF;

  row_id := COALESCE(new_row ->> 'id', old_row ->> 'id');
  IF row_id IS NULL THEN
    row_id := concat_ws(':', COALESCE(new_row ->> 'rol_id', old_row ->> 'rol_id'),
      COALESCE(new_row ->> 'permiso_id', old_row ->> 'permiso_id'));
  END IF;

  SELECT ctx.tipo_actor, ctx.usuario_id
    INTO actor_kind, actor_user
    FROM public.validar_contexto_actor() AS ctx;
  correlation := nullif(current_setting('app.correlation_id', true), '');
  action_name := TG_OP;
  IF TG_OP = 'UPDATE' AND (
    (old_row ->> 'cancelado_en' IS DISTINCT FROM new_row ->> 'cancelado_en'
      AND new_row ->> 'cancelado_en' IS NOT NULL)
  ) THEN
    action_name := 'CANCEL';
  END IF;

  INSERT INTO public.auditoria (
    tipo_actor, usuario_id, operacion, entidad, entidad_id,
    valores_anteriores, valores_nuevos, correlacion_id
  ) VALUES (
    actor_kind, actor_user, action_name, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    row_id, old_row, new_row, correlation::uuid
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_auditoria_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no puede actualizarse ni eliminarse';
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_borrado_historico()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'El registro es histórico; use su mecanismo de cancelación o eliminación lógica';
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_cierre_reserva_folio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las reservas de folios se conservan históricamente';
  END IF;
  IF OLD.es_actual IS TRUE AND NEW.es_actual IS FALSE
     AND (to_jsonb(NEW) - 'es_actual') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'es_actual') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Una reserva de folio solo puede dejar de ser actual durante una corrección';
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_estado_trabajo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_kind text;
  actor_user uuid;
  document_id uuid;
  document_state text;
  document_canceled timestamptz;
  old_state text;
  new_state text;
BEGIN
  SELECT ctx.tipo_actor, ctx.usuario_id INTO actor_kind, actor_user
    FROM public.validar_contexto_actor() AS ctx;

  IF TG_TABLE_NAME = 'documentos_cortos' THEN
    new_state := to_jsonb(NEW) ->> 'estado_trabajo';
    IF TG_OP = 'UPDATE' THEN old_state := to_jsonb(OLD) ->> 'estado_trabajo'; END IF;
  ELSE
    new_state := to_jsonb(NEW) ->> 'estado';
    IF TG_OP = 'UPDATE' THEN old_state := to_jsonb(OLD) ->> 'estado'; END IF;
  END IF;

  IF TG_OP = 'INSERT' AND new_state = 'finalizado' THEN
    RAISE EXCEPTION 'Cree el registro en construcción y finalícelo mediante una actualización auditada';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF old_state = 'finalizado' THEN
      IF TG_TABLE_NAME NOT IN ('documentos_cortos', 'ordenes_fabricacion')
         OR (to_jsonb(NEW) - ARRAY[
           'folio_fisico', 'folio_fisico_normalizado', 'cancelado_por',
           'cancelado_en', 'motivo_cancelacion', 'actualizado_en'
         ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
           'folio_fisico', 'folio_fisico_normalizado', 'cancelado_por',
           'cancelado_en', 'motivo_cancelacion', 'actualizado_en'
         ]) THEN
        RAISE EXCEPTION 'El registro finalizado es de consulta; use la operación excepcional autorizada';
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'documentos_cortos' THEN
      document_id := NEW.id;
      IF OLD.cancelado_en IS NOT NULL
         AND (to_jsonb(NEW) - ARRAY[
           'folio_fisico', 'folio_fisico_normalizado', 'cancelado_por',
           'cancelado_en', 'motivo_cancelacion', 'actualizado_en'
         ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
           'folio_fisico', 'folio_fisico_normalizado', 'cancelado_por',
           'cancelado_en', 'motivo_cancelacion', 'actualizado_en'
         ]) THEN
        RAISE EXCEPTION 'Una hoja cancelada solo admite corregir folio o cambiar su cancelación';
      END IF;
      IF NEW.cancelado_en IS NOT DISTINCT FROM OLD.cancelado_en
         AND NEW.cancelado_por IS DISTINCT FROM OLD.cancelado_por THEN
        RAISE EXCEPTION 'El autor de cancelación solo se asigna mediante la operación de cancelación';
      END IF;
      IF NEW.cancelado_en IS DISTINCT FROM OLD.cancelado_en THEN
        IF NEW.cancelado_en IS NULL THEN
          NEW.cancelado_por := NULL;
        ELSE
          IF actor_kind <> 'usuario' THEN
            RAISE EXCEPTION 'La cancelación requiere una acción de usuario';
          END IF;
          NEW.cancelado_por := actor_user;
          NEW.cancelado_en := clock_timestamp();
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'ordenes_fabricacion' THEN
      document_id := NEW.documento_corto_id;
      IF OLD.cancelado_en IS NOT NULL
         AND (to_jsonb(NEW) - ARRAY[
           'cancelado_por', 'cancelado_en', 'motivo_cancelacion', 'actualizado_en'
         ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
           'cancelado_por', 'cancelado_en', 'motivo_cancelacion', 'actualizado_en'
         ]) THEN
        RAISE EXCEPTION 'Una orden cancelada solo admite cambiar su condición de cancelación';
      END IF;
      IF NEW.cancelado_en IS NOT DISTINCT FROM OLD.cancelado_en
         AND NEW.cancelado_por IS DISTINCT FROM OLD.cancelado_por THEN
        RAISE EXCEPTION 'El autor de cancelación solo se asigna mediante la operación de cancelación';
      END IF;
      IF NEW.cancelado_en IS DISTINCT FROM OLD.cancelado_en THEN
        IF NEW.cancelado_en IS NULL THEN
          NEW.cancelado_por := NULL;
        ELSE
          IF actor_kind <> 'usuario' THEN
            RAISE EXCEPTION 'La cancelación requiere una acción de usuario';
          END IF;
          NEW.cancelado_por := actor_user;
          NEW.cancelado_en := clock_timestamp();
        END IF;
      END IF;
    ELSE
      document_id := NEW.documento_corto_id;
    END IF;

    IF TG_TABLE_NAME IN ('trabajos', 'ordenes_fabricacion') THEN
      SELECT d.estado_trabajo, d.cancelado_en INTO document_state, document_canceled
        FROM public.documentos_cortos d WHERE d.id = document_id FOR SHARE;
      IF document_canceled IS NOT NULL THEN
        RAISE EXCEPTION 'No se puede modificar un trabajo de una hoja finalizada o cancelada';
      END IF;
      IF document_state = 'finalizado' THEN
        IF old_state IS DISTINCT FROM 'en_construccion'
           OR new_state IS DISTINCT FROM 'finalizado'
           OR actor_kind <> 'usuario' THEN
          RAISE EXCEPTION 'Bajo una hoja finalizada solo se permite finalizar un hijo pendiente';
        END IF;
        IF TG_TABLE_NAME = 'trabajos' AND OLD.eliminado_en IS NOT NULL THEN
          RAISE EXCEPTION 'No se puede finalizar un trabajo eliminado lógicamente';
        END IF;
        IF (to_jsonb(NEW) - ARRAY[
              'estado', 'finalizado_por', 'finalizado_en', 'actualizado_en'
            ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
              'estado', 'finalizado_por', 'finalizado_en', 'actualizado_en'
            ]) THEN
          RAISE EXCEPTION 'Bajo una hoja finalizada no se modifican datos del hijo';
        END IF;
      END IF;
    END IF;

    IF new_state IS DISTINCT FROM old_state AND new_state = 'finalizado' THEN
      IF actor_kind <> 'usuario' THEN
        RAISE EXCEPTION 'La finalización debe atribuirse a un usuario autorizado';
      END IF;
      IF TG_TABLE_NAME = 'documentos_cortos' THEN
        IF NEW.cancelado_en IS NOT NULL THEN
          RAISE EXCEPTION 'No se puede finalizar una hoja cancelada';
        END IF;
      ELSIF TG_TABLE_NAME = 'ordenes_fabricacion' AND NEW.cancelado_en IS NOT NULL THEN
        RAISE EXCEPTION 'No se puede finalizar una orden cancelada';
      END IF;
      NEW.finalizado_por := actor_user;
      NEW.finalizado_en := clock_timestamp();
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('trabajos', 'ordenes_fabricacion') THEN
    document_id := NEW.documento_corto_id;
    SELECT d.estado_trabajo, d.cancelado_en INTO document_state, document_canceled
      FROM public.documentos_cortos d WHERE d.id = document_id FOR SHARE;
    IF document_state = 'finalizado' OR document_canceled IS NOT NULL THEN
      RAISE EXCEPTION 'No se agregan trabajos u órdenes a una hoja finalizada o cancelada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documentos_estado_trabajo_validar
  BEFORE INSERT OR UPDATE ON public.documentos_cortos
  FOR EACH ROW EXECUTE FUNCTION public.validar_estado_trabajo();
CREATE TRIGGER trabajos_estado_validar
  BEFORE INSERT OR UPDATE ON public.trabajos
  FOR EACH ROW EXECUTE FUNCTION public.validar_estado_trabajo();
CREATE TRIGGER ordenes_estado_validar
  BEFORE INSERT OR UPDATE ON public.ordenes_fabricacion
  FOR EACH ROW EXECUTE FUNCTION public.validar_estado_trabajo();

CREATE OR REPLACE FUNCTION public.validar_evidencia_en_construccion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_kind text;
  actor_user uuid;
  document_id uuid;
  document_state text;
  document_canceled timestamptz;
BEGIN
  SELECT ctx.tipo_actor, ctx.usuario_id INTO actor_kind, actor_user
    FROM public.validar_contexto_actor() AS ctx;
  IF TG_OP = 'INSERT' THEN
    document_id := NEW.documento_corto_id;
  ELSE
    document_id := OLD.documento_corto_id;
  END IF;
  SELECT d.estado_trabajo, d.cancelado_en INTO document_state, document_canceled
    FROM public.documentos_cortos d WHERE d.id = document_id FOR SHARE;
  IF document_state IS DISTINCT FROM 'en_construccion' OR document_canceled IS NOT NULL THEN
    RAISE EXCEPTION 'Las evidencias solo se agregan o eliminan mientras la hoja está en construcción';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF actor_kind <> 'usuario' THEN RAISE EXCEPTION 'La evidencia requiere un usuario responsable'; END IF;
    IF NEW.eliminada_en IS NOT NULL OR NEW.eliminada_por IS NOT NULL THEN
      RAISE EXCEPTION 'La evidencia nueva se registra activa';
    END IF;
    NEW.subida_por := actor_user;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.documento_corto_id IS DISTINCT FROM OLD.documento_corto_id
       OR NEW.ruta_storage IS DISTINCT FROM OLD.ruta_storage
       OR NEW.subida_por IS DISTINCT FROM OLD.subida_por
       OR NEW.subida_en IS DISTINCT FROM OLD.subida_en THEN
      RAISE EXCEPTION 'La referencia original de una evidencia no se reemplaza';
    END IF;
    IF OLD.eliminada_en IS NOT NULL AND NEW.eliminada_en IS NULL THEN
      RAISE EXCEPTION 'Una evidencia eliminada lógicamente no se reactiva';
    END IF;
    IF NEW.eliminada_en IS DISTINCT FROM OLD.eliminada_en THEN
      IF OLD.eliminada_en IS NOT NULL
         OR (to_jsonb(NEW) - ARRAY['eliminada_por', 'eliminada_en'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['eliminada_por', 'eliminada_en']) THEN
        RAISE EXCEPTION 'La eliminación lógica solo modifica los datos de baja';
      END IF;
      IF actor_kind <> 'usuario' THEN RAISE EXCEPTION 'La eliminación requiere un usuario responsable'; END IF;
      NEW.eliminada_por := actor_user;
      NEW.eliminada_en := clock_timestamp();
    ELSIF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'Los metadatos originales de una evidencia son inmutables';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidencias_estado_validar
  BEFORE INSERT OR UPDATE ON public.evidencias
  FOR EACH ROW EXECUTE FUNCTION public.validar_evidencia_en_construccion();

CREATE OR REPLACE FUNCTION public.validar_impresion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_kind text;
  actor_user uuid;
  current_version integer;
  requested_version integer;
BEGIN
  SELECT ctx.tipo_actor, ctx.usuario_id INTO actor_kind, actor_user
    FROM public.validar_contexto_actor() AS ctx;
  IF actor_kind <> 'usuario' THEN
    RAISE EXCEPTION 'La impresión requiere una acción de usuario';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT max(v.numero_version) INTO current_version
      FROM public.versiones_fabricacion v
     WHERE v.orden_fabricacion_id = (
       SELECT v2.orden_fabricacion_id FROM public.versiones_fabricacion v2
        WHERE v2.id = NEW.version_fabricacion_id
     );
    SELECT v.numero_version INTO requested_version
      FROM public.versiones_fabricacion v WHERE v.id = NEW.version_fabricacion_id;
    IF requested_version IS NULL OR requested_version <> current_version THEN
      RAISE EXCEPTION 'Solo se puede solicitar la impresión de la versión vigente';
    END IF;
    NEW.estado := 'solicitada';
    NEW.solicitada_por := actor_user;
    NEW.solicitada_en := clock_timestamp();
    NEW.confirmada_por := NULL;
    NEW.confirmada_en := NULL;
  ELSE
    IF NEW.version_fabricacion_id IS DISTINCT FROM OLD.version_fabricacion_id
       OR NEW.solicitada_por IS DISTINCT FROM OLD.solicitada_por
       OR NEW.solicitada_en IS DISTINCT FROM OLD.solicitada_en THEN
      RAISE EXCEPTION 'La solicitud de impresión es inmutable';
    END IF;
    IF OLD.estado <> 'solicitada' THEN
      RAISE EXCEPTION 'Una impresión resuelta no se modifica; cree otra solicitud si aplica';
    END IF;
    IF NEW.estado NOT IN ('confirmada', 'fallida', 'cancelada') THEN
      RAISE EXCEPTION 'Transición de impresión no permitida';
    END IF;
    IF NEW.estado = 'confirmada' THEN
      NEW.confirmada_por := actor_user;
      NEW.confirmada_en := clock_timestamp();
    ELSE
      NEW.confirmada_por := NULL;
      NEW.confirmada_en := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER impresiones_validar
  BEFORE INSERT OR UPDATE ON public.impresiones
  FOR EACH ROW EXECUTE FUNCTION public.validar_impresion();

CREATE TABLE public.notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auditoria_id bigint NOT NULL UNIQUE REFERENCES public.auditoria(id) ON DELETE RESTRICT,
  titulo text NOT NULL CHECK (btrim(titulo) <> ''),
  mensaje text NOT NULL CHECK (btrim(mensaje) <> ''),
  creada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notificacion_usuarios (
  notificacion_id uuid NOT NULL REFERENCES public.notificaciones(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  leida_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notificacion_id, usuario_id)
);

CREATE INDEX notificacion_usuarios_usuario_pendientes_idx
  ON public.notificacion_usuarios (usuario_id, creada_en DESC) WHERE leida_en IS NULL;

CREATE OR REPLACE FUNCTION public.notificar_evento_auditado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  notice_id uuid;
  actor_name text;
  action_label text;
BEGIN
  SELECT u.nombre INTO actor_name FROM public.usuarios u WHERE u.id = NEW.usuario_id;
  IF NEW.tipo_actor = 'sistema' THEN
    actor_name := 'El sistema';
  ELSE
    actor_name := coalesce(actor_name, 'Un trabajador');
  END IF;
  action_label := CASE NEW.operacion
    WHEN 'INSERT' THEN 'registró'
    WHEN 'UPDATE' THEN 'actualizó'
    WHEN 'CANCEL' THEN 'canceló'
    WHEN 'DELETE' THEN 'eliminó'
  END;

  INSERT INTO public.notificaciones (auditoria_id, titulo, mensaje)
  VALUES (
    NEW.id,
    'Cambio en ' || split_part(NEW.entidad, '.', 2),
    actor_name || ' ' || action_label || ' información en ' || split_part(NEW.entidad, '.', 2)
  ) RETURNING id INTO notice_id;

  INSERT INTO public.notificacion_usuarios (notificacion_id, usuario_id)
  SELECT notice_id, u.id FROM public.usuarios u WHERE u.activo;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auditoria_generar_notificacion
  AFTER INSERT ON public.auditoria
  FOR EACH ROW EXECUTE FUNCTION public.notificar_evento_auditado();

CREATE OR REPLACE FUNCTION public.validar_destinatario_reporte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  role_code text;
  user_active boolean;
  designated boolean;
BEGIN
  SELECT r.codigo, u.activo, u.recibe_reporte_diario
    INTO role_code, user_active, designated
    FROM public.usuarios u JOIN public.roles r ON r.id = u.rol_id
   WHERE u.id = NEW.usuario_id;
  IF role_code IS DISTINCT FROM 'ADMINISTRACION' OR user_active IS DISTINCT FROM true
     OR designated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El destinatario debe ser un usuario activo de Administración designado para el reporte';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reportes_destinatarios_validar
  BEFORE INSERT OR UPDATE OF usuario_id ON public.reportes_diarios_destinatarios
  FOR EACH ROW EXECUTE FUNCTION public.validar_destinatario_reporte();

CREATE OR REPLACE FUNCTION public.proteger_resultado_destinatario_reporte()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'pendiente' OR NEW.intentos <> 0 OR NEW.enviado_en IS NOT NULL THEN
      RAISE EXCEPTION 'Una entrega nueva inicia pendiente, sin intentos';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reporte_diario_id IS DISTINCT FROM OLD.reporte_diario_id
     OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
     OR NEW.intentos < OLD.intentos THEN
    RAISE EXCEPTION 'No se cambia la identidad del destinatario ni se reduce el contador de intentos';
  END IF;
  IF OLD.estado = 'enviado' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Una entrega confirmada no se reabre ni se modifica';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reportes_destinatario_resultado_proteger
  BEFORE INSERT OR UPDATE ON public.reportes_diarios_destinatarios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_resultado_destinatario_reporte();

CREATE OR REPLACE FUNCTION public.validar_designacion_reporte_diario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  role_code text;
BEGIN
  IF NEW.recibe_reporte_diario THEN
    SELECT r.codigo INTO role_code FROM public.roles r WHERE r.id = NEW.rol_id;
    IF role_code IS DISTINCT FROM 'ADMINISTRACION' OR NOT NEW.activo THEN
      RAISE EXCEPTION 'Solo un usuario activo de Administración puede recibir el reporte diario';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_destinatario_reporte_validar
  BEFORE INSERT OR UPDATE OF rol_id, activo, recibe_reporte_diario ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.validar_designacion_reporte_diario();

CREATE OR REPLACE FUNCTION public.proteger_codigo_rol()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'El código interno de un rol es inmutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roles_codigo_inmutable
  BEFORE UPDATE OF codigo ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.proteger_codigo_rol();

CREATE OR REPLACE FUNCTION public.restringir_permiso_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  role_code text;
  permission_module text;
  target_role uuid;
  target_permission uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_role := OLD.rol_id;
    target_permission := OLD.permiso_id;
  ELSE
    target_role := NEW.rol_id;
    target_permission := NEW.permiso_id;
  END IF;
  SELECT r.codigo, p.modulo INTO role_code, permission_module
    FROM public.roles r
    JOIN public.permisos p ON p.id = target_permission
   WHERE r.id = target_role;
  IF permission_module = 'auditoria' AND role_code <> 'ADMINISTRACION' THEN
    RAISE EXCEPTION 'Solo Administración puede recibir permisos de auditoría';
  END IF;
  IF permission_module = 'auditoria' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'El permiso de auditoría de Administración no se elimina';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rol_permisos_auditoria_restringir
  BEFORE INSERT OR UPDATE OR DELETE ON public.rol_permisos
  FOR EACH ROW EXECUTE FUNCTION public.restringir_permiso_auditoria();

CREATE OR REPLACE FUNCTION public.proteger_clave_permiso()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.modulo IS DISTINCT FROM OLD.modulo OR NEW.operacion IS DISTINCT FROM OLD.operacion THEN
    RAISE EXCEPTION 'La clave de un permiso no se modifica; cree una clave nueva';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER permisos_clave_inmutable
  BEFORE UPDATE OF modulo, operacion ON public.permisos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_clave_permiso();

CREATE TABLE public.reportes_diarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_envio_local date NOT NULL UNIQUE,
  zona_horaria text NOT NULL DEFAULT 'America/Monterrey'
    CHECK (zona_horaria = 'America/Monterrey'),
  hora_programada time NOT NULL DEFAULT time '08:00'
    CHECK (hora_programada = time '08:00'),
  periodo_desde timestamptz NOT NULL,
  periodo_hasta timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'procesando', 'completado', 'fallido')),
  resumen jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(resumen) = 'object'),
  iniciada_en timestamptz NOT NULL DEFAULT now(),
  completada_en timestamptz,
  CONSTRAINT reportes_diarios_rango_valido CHECK (
    periodo_desde = ((fecha_envio_local - 1)::timestamp AT TIME ZONE 'America/Monterrey')
    AND periodo_hasta = (fecha_envio_local::timestamp AT TIME ZONE 'America/Monterrey')
    AND periodo_hasta > periodo_desde
  ),
  CONSTRAINT reportes_diarios_completado_coherente CHECK (
    (estado = 'completado') = (completada_en IS NOT NULL)
  )
);

CREATE TABLE public.reportes_diarios_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_diario_id uuid NOT NULL REFERENCES public.reportes_diarios(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  clave_idempotencia text GENERATED ALWAYS AS
    (reporte_diario_id::text || ':' || usuario_id::text) STORED UNIQUE,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'enviado', 'fallido')),
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_intento_en timestamptz,
  enviado_en timestamptz,
  identificador_proveedor text,
  ultimo_error text,
  UNIQUE (reporte_diario_id, usuario_id),
  CONSTRAINT reporte_destinatario_envio_coherente CHECK (
    (estado = 'enviado') = (enviado_en IS NOT NULL)
  )
);

CREATE INDEX reportes_destinatarios_estado_idx
  ON public.reportes_diarios_destinatarios (estado, reporte_diario_id);
CREATE INDEX reportes_destinatarios_usuario_idx
  ON public.reportes_diarios_destinatarios (usuario_id);

CREATE TRIGGER auditoria_no_update_delete
  BEFORE UPDATE OR DELETE ON public.auditoria
  FOR EACH ROW EXECUTE FUNCTION public.proteger_auditoria_append_only();

CREATE TRIGGER documentos_no_delete
  BEFORE DELETE ON public.documentos_cortos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER folios_reservados_no_update_delete
  BEFORE UPDATE OR DELETE ON public.folios_fisicos_reservados
  FOR EACH ROW EXECUTE FUNCTION public.validar_cierre_reserva_folio();
CREATE TRIGGER trabajos_no_delete
  BEFORE DELETE ON public.trabajos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER ordenes_no_delete
  BEFORE DELETE ON public.ordenes_fabricacion
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER impresiones_no_delete
  BEFORE DELETE ON public.impresiones
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER evidencias_no_delete
  BEFORE DELETE ON public.evidencias
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER usuarios_no_delete
  BEFORE DELETE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER clientes_no_delete
  BEFORE DELETE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER unidades_no_delete
  BEFORE DELETE ON public.unidades
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER roles_no_delete
  BEFORE DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER permisos_no_delete
  BEFORE DELETE ON public.permisos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER notificaciones_no_delete
  BEFORE DELETE ON public.notificaciones
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER reportes_diarios_no_delete
  BEFORE DELETE ON public.reportes_diarios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();
CREATE TRIGGER reportes_destinatarios_no_delete
  BEFORE DELETE ON public.reportes_diarios_destinatarios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_historico();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'roles', 'permisos', 'rol_permisos', 'usuarios', 'clientes', 'unidades',
    'documentos_cortos', 'trabajos', 'ordenes_fabricacion', 'versiones_fabricacion',
    'impresiones', 'evidencias'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria()',
      table_name || '_auditoria', table_name
    );
  END LOOP;
END;
$$;

-- Inicialización administrativa controlada: solo el propietario de la base puede invocarla.
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(
  p_auth_user_id uuid,
  p_nombre text,
  p_recibe_reporte_diario boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  admin_role_id uuid;
  previous_actor_type text;
  previous_actor_id text;
BEGIN
  IF p_auth_user_id IS NULL OR btrim(coalesce(p_nombre, '')) = '' THEN
    RAISE EXCEPTION 'Se requiere una identidad Auth y un nombre para el primer administrador';
  END IF;

  LOCK TABLE public.usuarios IN EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.usuarios) THEN
    RAISE EXCEPTION 'El bootstrap solo se permite cuando todavía no hay perfiles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_user_id) THEN
    RAISE EXCEPTION 'La identidad indicada no existe en Supabase Auth';
  END IF;

  SELECT r.id INTO admin_role_id
    FROM public.roles r WHERE r.codigo = 'ADMINISTRACION' AND r.activo;
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'No existe el rol activo de Administración';
  END IF;

  previous_actor_type := current_setting('app.actor_tipo', true);
  previous_actor_id := current_setting('app.actor_id', true);
  PERFORM set_config('app.actor_tipo', 'sistema', true);
  PERFORM set_config('app.actor_id', '', true);

  INSERT INTO public.usuarios (id, rol_id, nombre, activo, recibe_reporte_diario)
  VALUES (p_auth_user_id, admin_role_id, btrim(p_nombre), true, p_recibe_reporte_diario);

  PERFORM set_config('app.actor_tipo', coalesce(previous_actor_type, ''), true);
  PERFORM set_config('app.actor_id', coalesce(previous_actor_id, ''), true);
  RETURN p_auth_user_id;
END;
$$;

REVOKE ALL ON TABLE public.auditoria FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.auditoria TO service_role;
REVOKE ALL ON FUNCTION public.registrar_auditoria() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proteger_auditoria_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proteger_borrado_historico() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_cierre_reserva_folio() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_estado_trabajo() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_evidencia_en_construccion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notificar_evento_auditado() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_destinatario_reporte() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_designacion_reporte_diario() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_impresion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proteger_resultado_destinatario_reporte() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proteger_codigo_rol() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restringir_permiso_auditoria() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proteger_clave_permiso() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(uuid, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
