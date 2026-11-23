# Autenticación y permisos del backend

El backend recibe el access token Supabase Auth en `Authorization: Bearer <token>`. Usa `@supabase/supabase-js` y `auth.getClaims(token)`: el SDK valida la firma con el JWKS del proyecto cuando usa claves asimétricas y conserva compatibilidad con proyectos de clave simétrica mediante validación en Auth. El backend comprueba además `iss`, `aud`, `exp`, `iat`, `nbf`, `role=authenticated` y que `sub` sea un UUID. No confía en `getSession`, cookies, identificadores, roles o permisos enviados en headers alternos.

Después de validar el token, consulta `public.usuarios` usando como parámetro el `sub` verificado. La consulta exige `usuarios.activo` y `roles.activo`, deriva el rol y obtiene permisos de `permisos` a través de `rol_permisos`. La identidad de Supabase Auth sin perfil activo recibe `403`; token ausente, inválido, vencido o manipulado recibe `401`. Errores de dependencias Auth/PostgreSQL devuelven un mensaje genérico `503` sin exponer detalles internos.

## Endpoints de verificación

- `GET /api/auth/me` devuelve `id`, `nombre`, `rol` y permisos del perfil activo. No devuelve token, correo ni datos de Auth innecesarios. Responde con `Cache-Control: no-store`.
- `GET /api/auth/check` devuelve `{ "authenticated": true, "active": true }`. Comparte el mismo middleware y resolución de perfil; existe como verificación ligera para clientes que no necesitan los datos de `/me`.

No hay registro público, administración de usuarios, ni rutas de negocio o auditoría todavía. `hasPermission(user, "modulo.operacion")` es el punto común de autorización para futuras rutas; los permisos proceden de PostgreSQL. Para `auditoria.consultar` también requiere el rol `ADMINISTRACION`, y no existe endpoint que entregue el historial en esta fase.

## Variables

- `SUPABASE_URL`: URL HTTPS del proyecto (HTTP solo para `localhost` en desarrollo).
- `SUPABASE_PUBLISHABLE_KEY`: clave publicable para inicializar el cliente Auth en el servidor; nunca una clave `secret` ni `service_role`.
- `SUPABASE_JWT_AUDIENCE`: audiencia esperada; por defecto `authenticated`.

Configura estos valores solo en `backend/.env` local o en el almacén de secretos del VPS. No se creó ni modificó el archivo `.env`, usuarios Auth o perfiles PostgreSQL.

## Contexto de actor para futuras escrituras

`withActorTransaction(user, operation)` recibe el perfil activo que resolvió `AuthService`, reserva una sola conexión, inicia transacción, configura `app.actor_tipo='usuario'` y `app.actor_id` mediante `set_config(..., true)`, ejecuta el callback, y confirma o revierte. Siempre libera la conexión; si falla el rollback, la descarta del pool para que no retenga contexto de una operación previa. Ninguna ruta actual escribe datos de negocio.

No se debe construir el `user` del helper desde campos de una petición. La API deberá autenticar y autorizar antes de invocarlo, usar SQL parametrizado y ejecutar todas las consultas de la operación con el cliente recibido por el callback.

## Pruebas locales

Desde `backend/`:

```powershell
npm run typecheck
npm run build
npm test
```

La suite usa tokens, perfiles y pools simulados; no crea usuarios ni escribe en Supabase.
