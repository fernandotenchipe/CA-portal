-- Seguridad inicial: las tablas solo se consultan/modifican a través del backend VPS.
-- No se definen políticas RLS de lectura para trabajadores ni reglas Realtime todavía.
-- anon/authenticated quedan denegados por RLS; service_role omite RLS y nunca va al frontend.

REVOKE ALL ON TABLE
  public.roles, public.permisos, public.rol_permisos, public.usuarios,
  public.clientes, public.unidades, public.documentos_cortos,
  public.folios_fisicos_reservados, public.trabajos,
  public.ordenes_fabricacion, public.versiones_fabricacion, public.impresiones,
  public.evidencias, public.auditoria, public.notificaciones,
  public.notificacion_usuarios, public.reportes_diarios,
  public.reportes_diarios_destinatarios
FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE
  public.roles, public.permisos, public.rol_permisos, public.usuarios,
  public.clientes, public.unidades, public.documentos_cortos,
  public.folios_fisicos_reservados, public.trabajos,
  public.ordenes_fabricacion, public.versiones_fabricacion, public.impresiones,
  public.evidencias, public.auditoria, public.notificaciones,
  public.notificacion_usuarios, public.reportes_diarios,
  public.reportes_diarios_destinatarios
TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ordenes_fabricacion_folio_digital_seq TO service_role;
REVOKE ALL ON SEQUENCE public.auditoria_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Excepciones append-only/escritura solo vía función controlada.
REVOKE ALL ON public.auditoria FROM service_role;
GRANT SELECT ON public.auditoria TO service_role;
REVOKE ALL ON public.folios_fisicos_reservados FROM service_role;
GRANT SELECT ON public.folios_fisicos_reservados TO service_role;
REVOKE ALL ON public.versiones_fabricacion FROM service_role;
GRANT SELECT ON public.versiones_fabricacion TO service_role;
REVOKE ALL ON SEQUENCE public.auditoria_id_seq FROM service_role;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rol_permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_cortos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folios_fisicos_reservados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trabajos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordenes_fabricacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.versiones_fabricacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impresiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacion_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_diarios_destinatarios ENABLE ROW LEVEL SECURITY;
