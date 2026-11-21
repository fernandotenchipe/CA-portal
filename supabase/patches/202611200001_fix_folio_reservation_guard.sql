-- Parche manual para proyectos V4 donde las migraciones iniciales ya fueron aplicadas.
-- Solo reemplaza dos funciones; no borra tablas ni modifica filas existentes.
-- Aplicar exclusivamente al proyecto Supabase de desarrollo, como propietario.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.folios_fisicos_reservados') IS NULL
     OR to_regclass('public.documentos_cortos') IS NULL
     OR to_regprocedure('public.reservar_folio_fisico_documento()') IS NULL
     OR to_regprocedure('public.validar_cierre_reserva_folio()') IS NULL THEN
    RAISE EXCEPTION 'No se reconoce el esquema CA-portal V4; parche cancelado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.documentos_cortos'::regclass
      AND tgname = 'documentos_folio_corregido_reservar'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.folios_fisicos_reservados'::regclass
      AND tgname = 'folios_reservados_no_update_delete'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'No se encontraron los triggers V4 esperados; parche cancelado';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservar_folio_fisico_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid;
  previous_correction_document text;
  reservation_closed boolean;
BEGIN
  SELECT ctx.usuario_id INTO actor
    FROM public.validar_contexto_actor() AS ctx
   WHERE ctx.tipo_actor = 'usuario';
  IF actor IS NULL THEN
    RAISE EXCEPTION 'La asignación de un folio requiere un usuario autenticado';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.folios_fisicos_reservados (
      documento_corto_id, folio_capturado, registrado_por
    ) VALUES (NEW.id, NEW.folio_fisico, actor);
  ELSIF NEW.folio_fisico_normalizado IS DISTINCT FROM OLD.folio_fisico_normalizado THEN
    previous_correction_document := current_setting('ca.folio_correction_document_id', true);
    PERFORM set_config('ca.folio_correction_document_id', OLD.id::text, true);

    UPDATE public.folios_fisicos_reservados
       SET es_actual = false
     WHERE documento_corto_id = OLD.id AND es_actual;

    reservation_closed := FOUND;
    PERFORM set_config(
      'ca.folio_correction_document_id',
      coalesce(previous_correction_document, ''),
      true
    );

    IF NOT reservation_closed THEN
      RAISE EXCEPTION 'No existe una reserva vigente para el folio actual del documento %', OLD.id;
    END IF;

    INSERT INTO public.folios_fisicos_reservados (
      documento_corto_id, folio_capturado, registrado_por
    ) VALUES (NEW.id, NEW.folio_fisico, actor);
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_cierre_reserva_folio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  correction_document_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las reservas de folios se conservan históricamente';
  END IF;

  correction_document_id := nullif(
    current_setting('ca.folio_correction_document_id', true), ''
  );

  IF OLD.es_actual IS TRUE AND NEW.es_actual IS FALSE
     AND correction_document_id = OLD.documento_corto_id::text
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.documento_corto_id IS NOT DISTINCT FROM OLD.documento_corto_id
     AND NEW.folio_capturado IS NOT DISTINCT FROM OLD.folio_capturado
     AND NEW.registrado_por IS NOT DISTINCT FROM OLD.registrado_por
     AND NEW.registrado_en IS NOT DISTINCT FROM OLD.registrado_en THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Una reserva de folio solo puede dejar de ser actual durante una corrección';
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_folio_fisico_documento()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_cierre_reserva_folio()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF position(
       'ca.folio_correction_document_id' IN
       pg_get_functiondef('public.reservar_folio_fisico_documento()'::regprocedure)
     ) = 0
     OR position(
       'ca.folio_correction_document_id' IN
       pg_get_functiondef('public.validar_cierre_reserva_folio()'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'No se verificó el nuevo control interno de corrección';
  END IF;
END;
$$;

COMMIT;
