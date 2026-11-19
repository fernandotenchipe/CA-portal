-- BORRADOR FUTURO. No está dentro de supabase/migrations y no pertenece a la
-- secuencia inicial. Revisar cuando se apruebe el módulo de facturas externas.
-- No emite CFDI, no registra pagos y no resuelve parcialidades.

CREATE TABLE public.facturas_externas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_emisor text NOT NULL CHECK (btrim(clave_emisor) <> ''),
  referencia_externa text NOT NULL CHECK (btrim(referencia_externa) <> ''),
  clave_emisor_normalizada text GENERATED ALWAYS AS (upper(btrim(clave_emisor))) STORED,
  referencia_normalizada text GENERATED ALWAYS AS (upper(btrim(referencia_externa))) STORED,
  documento_corto_id uuid UNIQUE
    REFERENCES public.documentos_cortos(id) ON DELETE RESTRICT,
  estado_externo text NOT NULL DEFAULT 'emitida'
    CHECK (estado_externo IN ('emitida', 'cancelada')),
  fecha_emision date,
  observaciones text,
  registrada_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facturas_emisor_referencia_uq
    UNIQUE (clave_emisor_normalizada, referencia_normalizada)
);

CREATE INDEX facturas_externas_documento_idx ON public.facturas_externas (documento_corto_id);

-- Pendiente al aprobar: reglas de RLS, auditoría, notificación, permisos, formato
-- de clave de emisor/referencia y si la cardinalidad uno-a-uno sigue siendo válida.
