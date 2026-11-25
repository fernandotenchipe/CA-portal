-- Propuesta para revisión: matriz aprobada de Clientes y Unidades.
-- No ejecutar hasta recibir autorización explícita.
-- Idempotente: no duplica permisos ni vínculos ya existentes.

BEGIN;

SELECT set_config('app.actor_tipo', 'sistema', true);
SELECT set_config('app.actor_id', '', true);

INSERT INTO public.permisos (modulo, operacion, descripcion)
VALUES
  ('clientes', 'consultar', 'Consultar clientes.'),
  ('clientes', 'crear', 'Registrar clientes.'),
  ('clientes', 'editar', 'Editar clientes.'),
  ('unidades', 'consultar', 'Consultar unidades.'),
  ('unidades', 'crear', 'Registrar unidades.'),
  ('unidades', 'editar', 'Editar unidades.')
ON CONFLICT (modulo, operacion) DO NOTHING;

-- Quita estos seis permisos de cualquier rol fuera de la matriz aprobada.
DELETE FROM public.rol_permisos AS rp
USING public.roles AS r, public.permisos AS p
WHERE rp.rol_id = r.id
  AND rp.permiso_id = p.id
  AND (p.modulo, p.operacion) IN (
    ('clientes', 'consultar'), ('clientes', 'crear'), ('clientes', 'editar'),
    ('unidades', 'consultar'), ('unidades', 'crear'), ('unidades', 'editar')
  )
  AND r.codigo NOT IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA');

INSERT INTO public.rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.roles AS r
CROSS JOIN public.permisos AS p
WHERE r.codigo IN ('ADMINISTRACION', 'VENTAS', 'LOGISTICA')
  AND (p.modulo, p.operacion) IN (
    ('clientes', 'consultar'), ('clientes', 'crear'), ('clientes', 'editar'),
    ('unidades', 'consultar'), ('unidades', 'crear'), ('unidades', 'editar')
  )
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

COMMIT;
