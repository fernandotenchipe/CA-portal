-- Propuesta para revisión: permisos de hojas cortas y trabajos.
-- No ejecutar hasta recibir autorización explícita.
-- Idempotente: no duplica claves/vínculos y quita estas claves de roles no autorizados.

BEGIN;

SELECT set_config('app.actor_tipo', 'sistema', true);
SELECT set_config('app.actor_id', '', true);

INSERT INTO public.permisos (modulo, operacion, descripcion)
VALUES
  ('documentos_cortos', 'consultar', 'Consultar hojas cortas de trabajo.'),
  ('documentos_cortos', 'crear', 'Crear hojas cortas de trabajo.'),
  ('documentos_cortos', 'editar', 'Editar y finalizar hojas cortas de trabajo.'),
  ('trabajos', 'consultar', 'Consultar trabajos de hojas cortas.'),
  ('trabajos', 'crear', 'Agregar trabajos a hojas cortas.'),
  ('trabajos', 'editar', 'Editar y finalizar trabajos de hojas cortas.')
ON CONFLICT (modulo, operacion) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roles
      WHERE codigo IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA')) <> 3 THEN
    RAISE EXCEPTION 'No se encontraron los tres roles autorizados; no se asignaron permisos';
  END IF;
  IF (SELECT count(*) FROM public.permisos
      WHERE (modulo, operacion) IN (
        ('documentos_cortos', 'consultar'),
        ('documentos_cortos', 'crear'),
        ('documentos_cortos', 'editar'),
        ('trabajos', 'consultar'),
        ('trabajos', 'crear'),
        ('trabajos', 'editar')
      )) <> 6 THEN
    RAISE EXCEPTION 'No están registradas las seis claves esperadas';
  END IF;
END;
$$;

-- Retira asignaciones previas de estas claves a cualquier otro rol.
DELETE FROM public.rol_permisos AS rp
USING public.roles AS r, public.permisos AS p
WHERE rp.rol_id = r.id
  AND rp.permiso_id = p.id
  AND (p.modulo, p.operacion) IN (
    ('documentos_cortos', 'consultar'),
    ('documentos_cortos', 'crear'),
    ('documentos_cortos', 'editar'),
    ('trabajos', 'consultar'),
    ('trabajos', 'crear'),
    ('trabajos', 'editar')
  )
  AND r.codigo NOT IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA');

-- Concede las 6 claves a cada uno de los 3 roles aprobados (18 vínculos).
INSERT INTO public.rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.roles AS r
CROSS JOIN public.permisos AS p
WHERE r.codigo IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA')
  AND (p.modulo, p.operacion) IN (
    ('documentos_cortos', 'consultar'),
    ('documentos_cortos', 'crear'),
    ('documentos_cortos', 'editar'),
    ('trabajos', 'consultar'),
    ('trabajos', 'crear'),
    ('trabajos', 'editar')
  )
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

DO $$
DECLARE
  authorized_assignments integer;
  unauthorized_assignments integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE r.codigo IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA')),
    count(*) FILTER (WHERE r.codigo NOT IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA'))
  INTO authorized_assignments, unauthorized_assignments
  FROM public.rol_permisos AS rp
  JOIN public.roles AS r ON r.id = rp.rol_id
  JOIN public.permisos AS p ON p.id = rp.permiso_id
  WHERE (p.modulo, p.operacion) IN (
    ('documentos_cortos', 'consultar'),
    ('documentos_cortos', 'crear'),
    ('documentos_cortos', 'editar'),
    ('trabajos', 'consultar'),
    ('trabajos', 'crear'),
    ('trabajos', 'editar')
  );

  IF authorized_assignments <> 18 OR unauthorized_assignments <> 0 THEN
    RAISE EXCEPTION 'Matriz incompleta o con roles no autorizados (asignaciones autorizadas: %, no autorizadas: %)',
      authorized_assignments, unauthorized_assignments;
  END IF;
END;
$$;

COMMIT;

-- Verificación posterior a una aplicación autorizada: esperado 6, 18, 0.
-- permissions_registered = 6; authorized_assignments = 18;
-- unauthorized_assignments = 0.
WITH expected_permissions(modulo, operacion) AS (
  VALUES
    ('documentos_cortos', 'consultar'),
    ('documentos_cortos', 'crear'),
    ('documentos_cortos', 'editar'),
    ('trabajos', 'consultar'),
    ('trabajos', 'crear'),
    ('trabajos', 'editar')
), expected_roles(codigo) AS (
  VALUES ('ADMINISTRACION'), ('VENTAS'), ('LOGISTICA')
), permission_rows AS (
  SELECT p.id, p.modulo, p.operacion
  FROM public.permisos AS p
  JOIN expected_permissions AS e USING (modulo, operacion)
), assignments AS (
  SELECT r.codigo, p.modulo, p.operacion
  FROM public.rol_permisos AS rp
  JOIN public.roles AS r ON r.id = rp.rol_id
  JOIN permission_rows AS p ON p.id = rp.permiso_id
)
SELECT
  (SELECT count(*) FROM permission_rows) AS permissions_registered,
  (SELECT count(*) FROM assignments AS a JOIN expected_roles AS er USING (codigo)) AS authorized_assignments,
  (SELECT count(*) FROM assignments AS a LEFT JOIN expected_roles AS er USING (codigo) WHERE er.codigo IS NULL) AS unauthorized_assignments;
