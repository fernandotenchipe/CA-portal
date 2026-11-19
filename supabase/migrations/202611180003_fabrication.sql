-- Órdenes y versiones técnicas de fabricación. Estados generales aprobados.

CREATE TABLE public.ordenes_fabricacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_corto_id uuid NOT NULL UNIQUE
    REFERENCES public.documentos_cortos(id) ON DELETE RESTRICT,
  folio_digital bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  estado text NOT NULL DEFAULT 'en_construccion'
    CHECK (estado IN ('en_construccion', 'finalizado')),
  finalizado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  finalizado_en timestamptz,
  cancelado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  cancelado_en timestamptz,
  motivo_cancelacion text,
  fecha_estimada_inicio date,
  fecha_estimada_entrega date,
  fecha_inicio_real date,
  fecha_entrega_real date,
  creado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ordenes_finalizacion_coherente CHECK (
    (estado = 'finalizado') = (finalizado_por IS NOT NULL AND finalizado_en IS NOT NULL)
  ),
  CONSTRAINT ordenes_cancelacion_coherente CHECK (
    (cancelado_por IS NULL) = (cancelado_en IS NULL)
  ),
  CONSTRAINT ordenes_fechas_estimadas_coherentes CHECK (
    fecha_estimada_inicio IS NULL OR fecha_estimada_entrega IS NULL
    OR fecha_estimada_entrega >= fecha_estimada_inicio
  ),
  CONSTRAINT ordenes_fechas_reales_coherentes CHECK (
    fecha_inicio_real IS NULL OR fecha_entrega_real IS NULL
    OR fecha_entrega_real >= fecha_inicio_real
  )
);

CREATE OR REPLACE FUNCTION public.proteger_orden_documento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.documento_corto_id IS DISTINCT FROM OLD.documento_corto_id THEN
    RAISE EXCEPTION 'La hoja propietaria de una orden no se cambia';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orden_documento_inmutable
  BEFORE UPDATE OF documento_corto_id ON public.ordenes_fabricacion
  FOR EACH ROW EXECUTE FUNCTION public.proteger_orden_documento();

CREATE TABLE public.versiones_fabricacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_fabricacion_id uuid NOT NULL
    REFERENCES public.ordenes_fabricacion(id) ON DELETE RESTRICT,
  numero_version integer NOT NULL CHECK (numero_version > 0),
  version_esquema integer NOT NULL DEFAULT 1 CHECK (version_esquema > 0),
  especificaciones jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(especificaciones) = 'object'),
  es_excepcional boolean NOT NULL DEFAULT false,
  motivo_excepcional text,
  creada_por uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT versiones_orden_numero_uq UNIQUE (orden_fabricacion_id, numero_version),
  CONSTRAINT versiones_orden_id_uq UNIQUE (orden_fabricacion_id, id),
  CONSTRAINT versiones_motivo_excepcional_coherente CHECK (
    (es_excepcional AND btrim(coalesce(motivo_excepcional, '')) <> '')
    OR (NOT es_excepcional AND motivo_excepcional IS NULL)
  )
);

CREATE INDEX versiones_fabricacion_orden_id_idx
  ON public.versiones_fabricacion (orden_fabricacion_id);

CREATE OR REPLACE FUNCTION public.crear_version_inicial_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid;
BEGIN
  SELECT ctx.usuario_id INTO actor
    FROM public.validar_contexto_actor() AS ctx
   WHERE ctx.tipo_actor = 'usuario';
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Crear una orden requiere una sesión de usuario';
  END IF;

  INSERT INTO public.versiones_fabricacion (
    orden_fabricacion_id, numero_version, version_esquema,
    especificaciones, creada_por
  ) VALUES (NEW.id, 1, 1, '{}'::jsonb, actor);
  RETURN NEW;
END;
$$;

CREATE TRIGGER orden_crear_version_inicial
  AFTER INSERT ON public.ordenes_fabricacion
  FOR EACH ROW EXECUTE FUNCTION public.crear_version_inicial_orden();

CREATE OR REPLACE FUNCTION public.proteger_version_fabricacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Las versiones de fabricación son inmutables; cree una versión nueva';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER versiones_fabricacion_inmutables
  BEFORE UPDATE OR DELETE ON public.versiones_fabricacion
  FOR EACH ROW EXECUTE FUNCTION public.proteger_version_fabricacion();

CREATE TABLE public.impresiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_fabricacion_id uuid NOT NULL
    REFERENCES public.versiones_fabricacion(id) ON DELETE RESTRICT,
  estado text NOT NULL DEFAULT 'solicitada'
    CHECK (estado IN ('solicitada', 'confirmada', 'fallida', 'cancelada')),
  solicitada_por uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  confirmada_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  confirmada_en timestamptz,
  impresora text,
  detalle_fallo text,
  CONSTRAINT impresiones_confirmacion_coherente CHECK (
    (estado = 'confirmada') = (confirmada_por IS NOT NULL AND confirmada_en IS NOT NULL)
  )
);

CREATE INDEX impresiones_version_id_idx ON public.impresiones (version_fabricacion_id);
CREATE INDEX impresiones_estado_idx ON public.impresiones (estado);

CREATE OR REPLACE FUNCTION public.crear_version_fabricacion(
  p_orden_fabricacion_id uuid,
  p_version_esquema integer,
  p_especificaciones jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid;
  next_version integer;
  result_id uuid;
  document_id uuid;
  order_state text;
  order_canceled_at timestamptz;
  document_state text;
  document_canceled_at timestamptz;
BEGIN
  SELECT ctx.usuario_id INTO actor
    FROM public.validar_contexto_actor() AS ctx
   WHERE ctx.tipo_actor = 'usuario';
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Crear una versión requiere una sesión de usuario';
  END IF;
  IF p_version_esquema IS NULL OR p_version_esquema < 1
     OR jsonb_typeof(p_especificaciones) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Especificaciones o versión de esquema inválidas';
  END IF;

  SELECT o.documento_corto_id INTO document_id
    FROM public.ordenes_fabricacion o WHERE o.id = p_orden_fabricacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la orden de fabricación %', p_orden_fabricacion_id;
  END IF;
  SELECT d.estado_trabajo, d.cancelado_en
    INTO document_state, document_canceled_at
    FROM public.documentos_cortos d WHERE d.id = document_id FOR UPDATE;
  SELECT o.estado, o.cancelado_en
    INTO order_state, order_canceled_at
    FROM public.ordenes_fabricacion o
   WHERE o.id = p_orden_fabricacion_id AND o.documento_corto_id = document_id
   FOR UPDATE;
  IF order_state <> 'en_construccion' OR order_canceled_at IS NOT NULL
     OR document_state <> 'en_construccion' OR document_canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'La orden u hoja no admite una versión ordinaria';
  END IF;

  SELECT coalesce(max(v.numero_version), 0) + 1 INTO next_version
    FROM public.versiones_fabricacion v
   WHERE v.orden_fabricacion_id = p_orden_fabricacion_id;

  INSERT INTO public.versiones_fabricacion (
    orden_fabricacion_id, numero_version, version_esquema,
    especificaciones, creada_por
  ) VALUES (
    p_orden_fabricacion_id, next_version, p_version_esquema,
    p_especificaciones, actor
  ) RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_version_fabricacion_excepcional(
  p_orden_fabricacion_id uuid,
  p_version_esquema integer,
  p_especificaciones jsonb,
  p_motivo text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid;
  next_version integer;
  result_id uuid;
  document_id uuid;
  document_state text;
  document_canceled_at timestamptz;
  order_state text;
  order_canceled_at timestamptz;
BEGIN
  SELECT ctx.usuario_id INTO actor
    FROM public.validar_contexto_actor() AS ctx
   WHERE ctx.tipo_actor = 'usuario';
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Una versión excepcional requiere una sesión de usuario';
  END IF;
  IF p_version_esquema IS NULL OR p_version_esquema < 1
     OR jsonb_typeof(p_especificaciones) IS DISTINCT FROM 'object'
     OR btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'La versión excepcional requiere esquema, objeto JSON y motivo';
  END IF;

  SELECT o.documento_corto_id INTO document_id
    FROM public.ordenes_fabricacion o WHERE o.id = p_orden_fabricacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la orden de fabricación %', p_orden_fabricacion_id;
  END IF;
  SELECT d.estado_trabajo, d.cancelado_en INTO document_state, document_canceled_at
    FROM public.documentos_cortos d WHERE d.id = document_id FOR UPDATE;
  SELECT o.estado, o.cancelado_en INTO order_state, order_canceled_at
    FROM public.ordenes_fabricacion o
   WHERE o.id = p_orden_fabricacion_id AND o.documento_corto_id = document_id
   FOR UPDATE;
  IF order_state IS DISTINCT FROM 'finalizado' OR order_canceled_at IS NOT NULL
     OR document_state IS DISTINCT FROM 'finalizado' OR document_canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Solo una orden y hoja finalizadas y no canceladas admiten corrección excepcional';
  END IF;

  SELECT coalesce(max(v.numero_version), 0) + 1 INTO next_version
    FROM public.versiones_fabricacion v
   WHERE v.orden_fabricacion_id = p_orden_fabricacion_id;

  INSERT INTO public.versiones_fabricacion (
    orden_fabricacion_id, numero_version, version_esquema,
    especificaciones, es_excepcional, motivo_excepcional, creada_por
  ) VALUES (
    p_orden_fabricacion_id, next_version, p_version_esquema,
    p_especificaciones, true, btrim(p_motivo), actor
  ) RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_version_fabricacion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proteger_orden_documento() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crear_version_fabricacion(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_version_fabricacion_excepcional(uuid, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_version_inicial_orden() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_version_fabricacion(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crear_version_fabricacion_excepcional(uuid, integer, jsonb, text) TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.versiones_fabricacion FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.versiones_fabricacion TO service_role;
