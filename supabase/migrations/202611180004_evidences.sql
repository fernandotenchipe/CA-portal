-- Metadatos y referencia privada a fotografías/documentos de evidencia.

CREATE TABLE public.evidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_corto_id uuid NOT NULL
    REFERENCES public.documentos_cortos(id) ON DELETE RESTRICT,
  ruta_storage text NOT NULL UNIQUE CHECK (btrim(ruta_storage) <> ''),
  nombre_archivo text NOT NULL CHECK (btrim(nombre_archivo) <> ''),
  tipo_contenido text,
  tamano_bytes bigint CHECK (tamano_bytes IS NULL OR tamano_bytes > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-fA-F]{64}$'),
  subida_por uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  subida_en timestamptz NOT NULL DEFAULT now(),
  eliminada_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  eliminada_en timestamptz,
  CONSTRAINT evidencias_eliminacion_coherente CHECK (
    (eliminada_por IS NULL) = (eliminada_en IS NULL)
  )
);

CREATE INDEX evidencias_documento_corto_id_idx ON public.evidencias (documento_corto_id);
