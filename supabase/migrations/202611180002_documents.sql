-- Hojas cortas, reserva histórica de folios y trabajos.

CREATE TABLE public.documentos_cortos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_fisico text NOT NULL,
  folio_fisico_normalizado text GENERATED ALWAYS AS
    (upper(regexp_replace(btrim(folio_fisico), '[[:space:]]+', '', 'g'))) STORED,
  unidad_id uuid NOT NULL REFERENCES public.unidades(id) ON DELETE RESTRICT,
  estado_trabajo text NOT NULL DEFAULT 'en_construccion'
    CHECK (estado_trabajo IN ('en_construccion', 'finalizado')),
  finalizado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  finalizado_en timestamptz,
  observaciones text,
  fecha_documento date,
  creado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  cancelado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  cancelado_en timestamptz,
  motivo_cancelacion text,
  CONSTRAINT documentos_folio_formato CHECK (
    regexp_replace(btrim(folio_fisico), '[[:space:]]+', '', 'g') ~ '^[A-Za-z0-9-]+$'
  ),
  CONSTRAINT documentos_folio_normalizado_no_vacio CHECK (folio_fisico_normalizado <> ''),
  CONSTRAINT documentos_finalizacion_coherente CHECK (
    (estado_trabajo = 'finalizado') = (finalizado_por IS NOT NULL AND finalizado_en IS NOT NULL)
  ),
  CONSTRAINT documentos_cancelacion_coherente CHECK (
    (cancelado_por IS NULL) = (cancelado_en IS NULL)
  )
);

CREATE INDEX documentos_cortos_unidad_id_idx ON public.documentos_cortos (unidad_id);
CREATE INDEX documentos_cortos_estado_trabajo_idx ON public.documentos_cortos (estado_trabajo);

CREATE TABLE public.folios_fisicos_reservados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_corto_id uuid NOT NULL
    REFERENCES public.documentos_cortos(id) ON DELETE RESTRICT,
  folio_capturado text NOT NULL,
  folio_normalizado text GENERATED ALWAYS AS
    (upper(regexp_replace(btrim(folio_capturado), '[[:space:]]+', '', 'g'))) STORED,
  es_actual boolean NOT NULL DEFAULT true,
  registrado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folios_reservados_formato CHECK (
    regexp_replace(btrim(folio_capturado), '[[:space:]]+', '', 'g') ~ '^[A-Za-z0-9-]+$'
  ),
  CONSTRAINT folios_reservados_no_vacio CHECK (folio_normalizado <> ''),
  CONSTRAINT folios_reservados_normalizado_uq UNIQUE (folio_normalizado)
);

CREATE UNIQUE INDEX folios_reservados_un_actual_por_documento_uq
  ON public.folios_fisicos_reservados (documento_corto_id) WHERE es_actual;
CREATE INDEX folios_reservados_documento_id_idx
  ON public.folios_fisicos_reservados (documento_corto_id, registrado_en DESC);

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
    -- Autoriza únicamente la baja histórica asociada a esta corrección.
    -- El valor es local a la transacción y se restaura al terminar.
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

CREATE TRIGGER documentos_folio_reserva_inicial
  AFTER INSERT ON public.documentos_cortos
  FOR EACH ROW EXECUTE FUNCTION public.reservar_folio_fisico_documento();

CREATE TRIGGER documentos_folio_corregido_reservar
  AFTER UPDATE OF folio_fisico ON public.documentos_cortos
  FOR EACH ROW EXECUTE FUNCTION public.reservar_folio_fisico_documento();

CREATE TABLE public.trabajos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_corto_id uuid NOT NULL
    REFERENCES public.documentos_cortos(id) ON DELETE RESTRICT,
  numero_orden integer NOT NULL CHECK (numero_orden > 0),
  descripcion text NOT NULL CHECK (btrim(descripcion) <> ''),
  estado text NOT NULL DEFAULT 'en_construccion'
    CHECK (estado IN ('en_construccion', 'finalizado')),
  finalizado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  finalizado_en timestamptz,
  cantidad numeric(12,3) CHECK (cantidad IS NULL OR cantidad > 0),
  unidad_medida text,
  precio_unitario numeric(14,2) CHECK (precio_unitario IS NULL OR precio_unitario >= 0),
  importe numeric(16,2) GENERATED ALWAYS AS (
    CASE WHEN cantidad IS NOT NULL AND precio_unitario IS NOT NULL
      THEN round(cantidad * precio_unitario, 2)
      ELSE NULL
    END
  ) STORED,
  observaciones text,
  eliminado_en timestamptz,
  eliminado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trabajos_finalizacion_coherente CHECK (
    (estado = 'finalizado') = (finalizado_por IS NOT NULL AND finalizado_en IS NOT NULL)
  ),
  CONSTRAINT trabajos_baja_coherente CHECK (
    (eliminado_en IS NULL) = (eliminado_por IS NULL)
  ),
  CONSTRAINT trabajos_orden_documento_uq UNIQUE (documento_corto_id, numero_orden)
);

CREATE INDEX trabajos_documento_corto_id_idx ON public.trabajos (documento_corto_id);

REVOKE ALL ON FUNCTION public.reservar_folio_fisico_documento() FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.folios_fisicos_reservados
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.folios_fisicos_reservados TO service_role;
