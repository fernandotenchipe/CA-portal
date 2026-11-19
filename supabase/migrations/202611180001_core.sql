-- Propuesta V4. Ejecutar solo después de revisión y aprobación.
-- Requiere Supabase Auth (auth.users) y PostgreSQL 13+.

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z0-9_]+$'),
  nombre text NOT NULL UNIQUE CHECK (btrim(nombre) <> ''),
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.roles (codigo, nombre, descripcion) VALUES
  ('ADMINISTRACION', 'Administración', 'Acceso administrativo al sistema.'),
  ('VENTAS', 'Ventas', 'Acceso operativo a ventas.'),
  ('LOGISTICA', 'Logística', 'Acceso operativo a logística.');

CREATE TABLE public.permisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo text NOT NULL CHECK (btrim(modulo) <> ''),
  operacion text NOT NULL CHECK (btrim(operacion) <> ''),
  descripcion text,
  UNIQUE (modulo, operacion)
);

INSERT INTO public.permisos (modulo, operacion, descripcion)
VALUES ('auditoria', 'consultar', 'Consultar el historial detallado de auditoría.');

CREATE TABLE public.rol_permisos (
  rol_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  permiso_id uuid NOT NULL REFERENCES public.permisos(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE INDEX rol_permisos_permiso_id_idx ON public.rol_permisos (permiso_id);

INSERT INTO public.rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
  FROM public.roles r CROSS JOIN public.permisos p
 WHERE r.codigo = 'ADMINISTRACION'
   AND p.modulo = 'auditoria' AND p.operacion = 'consultar';

CREATE TABLE public.usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  rol_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  activo boolean NOT NULL DEFAULT true,
  recibe_reporte_diario boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usuarios_rol_id_idx ON public.usuarios (rol_id);

CREATE TABLE public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  razon_social text,
  rfc text,
  correo text,
  telefono text,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  numero_serie text NOT NULL,
  marca text,
  modelo text,
  anio smallint CHECK (anio IS NULL OR anio BETWEEN 1886 AND 2200),
  placas text,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidades_numero_serie_formato CHECK (numero_serie ~ '^[A-Z0-9]+$'),
  CONSTRAINT unidades_numero_serie_uq UNIQUE (numero_serie)
);

CREATE INDEX unidades_cliente_id_idx ON public.unidades (cliente_id);

CREATE OR REPLACE FUNCTION public.validar_contexto_actor()
RETURNS TABLE (tipo_actor text, usuario_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_type text;
  actor_text text;
  actor_uuid uuid;
BEGIN
  actor_type := nullif(current_setting('app.actor_tipo', true), '');
  actor_text := nullif(current_setting('app.actor_id', true), '');

  IF actor_type = 'usuario' THEN
    IF actor_text IS NULL THEN
      RAISE EXCEPTION 'Falta el actor autenticado para la operación';
    END IF;
    BEGIN
      actor_uuid := actor_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'El contexto del actor contiene un UUID inválido';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios u WHERE u.id = actor_uuid
    ) THEN
      RAISE EXCEPTION 'El actor no existe en el perfil de aplicación';
    END IF;
    RETURN QUERY SELECT 'usuario'::text, actor_uuid;
  ELSIF actor_type = 'sistema' THEN
    IF actor_text IS NOT NULL THEN
      RAISE EXCEPTION 'Una operación del sistema no debe atribuirse a un usuario';
    END IF;
    RETURN QUERY SELECT 'sistema'::text, NULL::uuid;
  ELSE
    RAISE EXCEPTION 'Falta un contexto de actor válido para auditar la operación';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_contexto_actor() FROM PUBLIC, anon, authenticated, service_role;
