-- Parche para actualizar solamente validar_estado_trabajo() en CA-portal V4.
-- Reemplaza una función; no modifica filas ni elimina objetos.
-- Aplicar como propietario únicamente al proyecto de desarrollo.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.documentos_cortos') IS NULL
     OR to_regclass('public.trabajos') IS NULL
     OR to_regclass('public.ordenes_fabricacion') IS NULL
     OR to_regprocedure('public.validar_estado_trabajo()') IS NULL THEN
    RAISE EXCEPTION 'No se reconoce el esquema CA-portal V4; parche cancelado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.documentos_cortos'::regclass AND tgname = 'documentos_estado_trabajo_validar' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.trabajos'::regclass AND tgname = 'trabajos_estado_validar' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ordenes_fabricacion'::regclass AND tgname = 'ordenes_estado_validar' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'No se encontraron los tres triggers V4 esperados; parche cancelado';
  END IF;
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
    new_state := NEW.estado_trabajo;
    IF TG_OP = 'UPDATE' THEN old_state := OLD.estado_trabajo; END IF;
  ELSIF TG_TABLE_NAME = 'trabajos' OR TG_TABLE_NAME = 'ordenes_fabricacion' THEN
    new_state := NEW.estado;
    IF TG_OP = 'UPDATE' THEN old_state := OLD.estado; END IF;
  ELSE
    RAISE EXCEPTION 'validar_estado_trabajo no admite la tabla %', TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'INSERT' AND new_state = 'finalizado' THEN
    RAISE EXCEPTION 'Cree el registro en construcción y finalícelo mediante una actualización auditada';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF old_state = 'finalizado' THEN
      IF TG_TABLE_NAME = 'trabajos' THEN
        RAISE EXCEPTION 'El registro finalizado es de consulta; use la operación excepcional autorizada';
      ELSIF TG_TABLE_NAME = 'documentos_cortos' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.unidad_id IS DISTINCT FROM OLD.unidad_id
           OR NEW.estado_trabajo IS DISTINCT FROM OLD.estado_trabajo
           OR NEW.finalizado_por IS DISTINCT FROM OLD.finalizado_por
           OR NEW.finalizado_en IS DISTINCT FROM OLD.finalizado_en
           OR NEW.observaciones IS DISTINCT FROM OLD.observaciones
           OR NEW.fecha_documento IS DISTINCT FROM OLD.fecha_documento
           OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
           OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
          RAISE EXCEPTION 'El registro finalizado es de consulta; use la operación excepcional autorizada';
        END IF;
      ELSIF TG_TABLE_NAME = 'ordenes_fabricacion' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.documento_corto_id IS DISTINCT FROM OLD.documento_corto_id
           OR NEW.folio_digital IS DISTINCT FROM OLD.folio_digital
           OR NEW.estado IS DISTINCT FROM OLD.estado
           OR NEW.finalizado_por IS DISTINCT FROM OLD.finalizado_por
           OR NEW.finalizado_en IS DISTINCT FROM OLD.finalizado_en
           OR NEW.fecha_estimada_inicio IS DISTINCT FROM OLD.fecha_estimada_inicio
           OR NEW.fecha_estimada_entrega IS DISTINCT FROM OLD.fecha_estimada_entrega
           OR NEW.fecha_inicio_real IS DISTINCT FROM OLD.fecha_inicio_real
           OR NEW.fecha_entrega_real IS DISTINCT FROM OLD.fecha_entrega_real
           OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
           OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
          RAISE EXCEPTION 'El registro finalizado es de consulta; use la operación excepcional autorizada';
        END IF;
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'documentos_cortos' THEN
      document_id := NEW.id;
      IF OLD.cancelado_en IS NOT NULL THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.unidad_id IS DISTINCT FROM OLD.unidad_id
           OR NEW.estado_trabajo IS DISTINCT FROM OLD.estado_trabajo
           OR NEW.finalizado_por IS DISTINCT FROM OLD.finalizado_por
           OR NEW.finalizado_en IS DISTINCT FROM OLD.finalizado_en
           OR NEW.observaciones IS DISTINCT FROM OLD.observaciones
           OR NEW.fecha_documento IS DISTINCT FROM OLD.fecha_documento
           OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
           OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
          RAISE EXCEPTION 'Una hoja cancelada solo admite corregir folio o cambiar su cancelación';
        END IF;
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
      IF OLD.cancelado_en IS NOT NULL THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.documento_corto_id IS DISTINCT FROM OLD.documento_corto_id
           OR NEW.folio_digital IS DISTINCT FROM OLD.folio_digital
           OR NEW.estado IS DISTINCT FROM OLD.estado
           OR NEW.finalizado_por IS DISTINCT FROM OLD.finalizado_por
           OR NEW.finalizado_en IS DISTINCT FROM OLD.finalizado_en
           OR NEW.fecha_estimada_inicio IS DISTINCT FROM OLD.fecha_estimada_inicio
           OR NEW.fecha_estimada_entrega IS DISTINCT FROM OLD.fecha_estimada_entrega
           OR NEW.fecha_inicio_real IS DISTINCT FROM OLD.fecha_inicio_real
           OR NEW.fecha_entrega_real IS DISTINCT FROM OLD.fecha_entrega_real
           OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
           OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
          RAISE EXCEPTION 'Una orden cancelada solo admite cambiar su condición de cancelación';
        END IF;
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
        IF TG_TABLE_NAME = 'trabajos' THEN
          IF OLD.eliminado_en IS NOT NULL THEN
            RAISE EXCEPTION 'No se puede finalizar un trabajo eliminado lógicamente';
          END IF;
          IF NEW.id IS DISTINCT FROM OLD.id
             OR NEW.documento_corto_id IS DISTINCT FROM OLD.documento_corto_id
             OR NEW.numero_orden IS DISTINCT FROM OLD.numero_orden
             OR NEW.descripcion IS DISTINCT FROM OLD.descripcion
             OR NEW.cantidad IS DISTINCT FROM OLD.cantidad
             OR NEW.unidad_medida IS DISTINCT FROM OLD.unidad_medida
             OR NEW.precio_unitario IS DISTINCT FROM OLD.precio_unitario
             OR NEW.observaciones IS DISTINCT FROM OLD.observaciones
             OR NEW.eliminado_en IS DISTINCT FROM OLD.eliminado_en
             OR NEW.eliminado_por IS DISTINCT FROM OLD.eliminado_por
             OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
            RAISE EXCEPTION 'Bajo una hoja finalizada no se modifican datos del hijo';
          END IF;
        ELSIF TG_TABLE_NAME = 'ordenes_fabricacion' THEN
          IF NEW.id IS DISTINCT FROM OLD.id
             OR NEW.documento_corto_id IS DISTINCT FROM OLD.documento_corto_id
             OR NEW.folio_digital IS DISTINCT FROM OLD.folio_digital
             OR NEW.cancelado_por IS DISTINCT FROM OLD.cancelado_por
             OR NEW.cancelado_en IS DISTINCT FROM OLD.cancelado_en
             OR NEW.motivo_cancelacion IS DISTINCT FROM OLD.motivo_cancelacion
             OR NEW.fecha_estimada_inicio IS DISTINCT FROM OLD.fecha_estimada_inicio
             OR NEW.fecha_estimada_entrega IS DISTINCT FROM OLD.fecha_estimada_entrega
             OR NEW.fecha_inicio_real IS DISTINCT FROM OLD.fecha_inicio_real
             OR NEW.fecha_entrega_real IS DISTINCT FROM OLD.fecha_entrega_real
             OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
             OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
            RAISE EXCEPTION 'Bajo una hoja finalizada no se modifican datos del hijo';
          END IF;
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
      ELSIF TG_TABLE_NAME = 'ordenes_fabricacion' THEN
        IF NEW.cancelado_en IS NOT NULL THEN
          RAISE EXCEPTION 'No se puede finalizar una orden cancelada';
        END IF;
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

REVOKE ALL ON FUNCTION public.validar_estado_trabajo()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF position('OLD.eliminado_en' IN pg_get_functiondef('public.validar_estado_trabajo()'::regprocedure)) = 0
     OR position('NEW.fecha_estimada_inicio' IN pg_get_functiondef('public.validar_estado_trabajo()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'No se verificó la definición esperada de validar_estado_trabajo';
  END IF;
END;
$$;

COMMIT;