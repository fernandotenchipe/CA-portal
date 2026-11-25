# Prueba secuencial de autenticación con una cuenta

## Alcance y precondiciones

Se reutilizará una sola identidad temporal de Supabase Auth para recorrer cinco estados de perfil. No se crean identidades adicionales ni se cambia la matriz de permisos.

La configuración del backend se verificó localmente sin mostrar `.env`: `SUPABASE_URL` usa HTTPS y su Project Ref coincide con el de `DATABASE_URL`. El propietario confirmó que este es el único proyecto CA-portal y se usa para desarrollo. La UUID proporcionada coincide con la identidad Auth temporal; una consulta de solo lectura confirmó que todavía no tiene perfil en `public.usuarios`. No se han hecho escrituras.

`public.usuarios.id` referencia `auth.users.id` con `ON DELETE RESTRICT`. `usuarios` tiene `activo`, `rol_id` y triggers de auditoría para INSERT/UPDATE; también tiene un trigger que bloquea DELETE. Roles `ADMINISTRACION`, `VENTAS` y `LOGISTICA` ya existen. La base solo asigna `auditoria.consultar` a Administración; Ventas y Logística tienen listas de permisos vacías. `/api/auth/me` y `/api/auth/check` requieren perfil y rol activos, no un permiso de módulo. No hay ruta de auditoría en esta fase.

La identidad de prueba ya existe en Supabase Auth. No crear otra cuenta ni escribir en `auth.users`. La autorización actual cubre sus transiciones auditadas de perfil/rol; la desactivación al concluir todavía requiere autorización separada.

## Secuencia de estados

Inicia el backend (`npm start`) y ejecuta desde otra terminal:

```powershell
cd backend
npm run build
$TestUserId = 'UUID-AUTH'
npm run auth:smoke -- --development --sequence --expected-user-id $TestUserId
```

El script solicita el correo en la terminal y la contraseña con entrada oculta. Antes de llamar al backend comprueba que la UUID autenticada coincide con `--expected-user-id`; si no coincide, se detiene. Conserva **el mismo access token en memoria** durante la secuencia y no imprime ni guarda el JWT. Después de cada cambio SQL, pulsa Enter en la terminal del script. Hace solicitudes HTTP reales a `/api/auth/me` y `/api/auth/check`, y comprueba que headers falsificados de usuario/rol/actor no cambien el perfil que devuelve la API.

Cada cambio de perfil se aplica como una transacción aislada desde SQL Editor del proyecto verificado, con `app.actor_tipo='sistema'` y `app.actor_id=''` locales. Esto crea la fila de auditoría con actor `sistema`; no cambia triggers, RLS ni permisos. La autorización para estas transiciones ya fue confirmada por el propietario.

### 1. Auth sin perfil

Inicia sesión en Auth y deja `public.usuarios` sin fila para la UUID. El script debe ver `403` en ambos endpoints.

### 2. Insertar perfil inactivo

Sustituye `<UUID-AUTH>` por la UUID del Dashboard y ejecuta:

```sql
BEGIN;
SELECT set_config('app.actor_tipo', 'sistema', true);
SELECT set_config('app.actor_id', '', true);

INSERT INTO public.usuarios (id, rol_id, nombre, activo, recibe_reporte_diario)
SELECT '<UUID-AUTH>'::uuid, r.id, 'CA-TEST-AUTENTICACION', false, false
FROM public.roles AS r
WHERE r.codigo = 'ADMINISTRACION' AND r.activo IS TRUE
RETURNING id;

COMMIT;
```

Se espera `403`. El INSERT dispara auditoría.

### 3. Activar Administración

```sql
BEGIN;
SELECT set_config('app.actor_tipo', 'sistema', true);
SELECT set_config('app.actor_id', '', true);

UPDATE public.usuarios
SET activo = true
WHERE id = '<UUID-AUTH>'::uuid
RETURNING id, activo, rol_id;

COMMIT;
```

Se espera `200`, rol `ADMINISTRACION` y permiso `auditoria.consultar`. El UPDATE queda auditado.

### 4. Cambiar a Ventas; 5. cambiar a Logística

Para cada estado ejecuta un bloque separado, con `COMMIT`, y luego pulsa Enter en el script:

```sql
BEGIN;
SELECT set_config('app.actor_tipo', 'sistema', true);
SELECT set_config('app.actor_id', '', true);

UPDATE public.usuarios AS u
SET rol_id = r.id
FROM public.roles AS r
WHERE u.id = '<UUID-AUTH>'::uuid
  AND r.codigo = 'VENTAS'
  AND r.activo IS TRUE
RETURNING u.id, r.codigo, u.activo;

COMMIT;
```

Para el siguiente estado cambia `VENTAS` por `LOGISTICA`. Cada cambio de rol se audita. Se espera `200` en ambos endpoints. El `/me` del mismo JWT debe mostrar el rol y permisos actuales leídos de PostgreSQL: hoy ambos roles no tienen permisos asignados. `hasPermission` debe indicar que no pueden consultar auditoría; Administración sí puede. No se expone una ruta de auditoría para esta comprobación.

El backend ejecuta una consulta parametrizada a `usuarios`, `roles`, `rol_permisos` y `permisos` en cada petición protegida; no cachea el rol ni la lista de permisos. El mismo token permite comprobar que los cambios se reflejan inmediatamente.

En cada estado activo, el script contrasta los permisos devueltos con la matriz actual de PostgreSQL: Administración debe tener `auditoria.consultar`; Ventas y Logística deben tener `[]`. También comprueba `hasPermission` para esa operación. Al final manda un JWT falsificado y espera `401`. Estas comprobaciones no requieren cuentas adicionales ni una ruta de auditoría.

## Verificación y auditoría

Revisa después de cada transacción en SQL Editor que `RETURNING` afectó exactamente una fila. Para revisar solo la metadata de auditoría de la UUID de prueba, el propietario puede usar una consulta de solo lectura a `public.auditoria` filtrada por `entidad='usuarios'` y `entidad_id='<UUID-AUTH>'`; no exportes snapshots completos.

## Desactivación posterior

Al terminar las pruebas, el último rol quedará en Logística. La desactivación se prepara pero requiere una nueva autorización antes de ejecutarse:

1. En Supabase Auth, bloquear el inicio de sesión de la identidad temporal desde Dashboard.
2. En una transacción auditada con contexto local de sistema, actualizar `public.usuarios.activo=false` para la UUID.
3. Verificar que el perfil está inactivo y que `/me`/`check` responden `403` con cualquier token aún vigente.

El token JWT ya emitido puede seguir siendo criptográficamente válido hasta su `exp`; el perfil inactivo hace que el backend deniegue la solicitud inmediatamente. [Supabase: sesiones y expiración de JWT](https://supabase.com/docs/guides/auth/sessions)

No eliminar físicamente el perfil: `usuarios_no_delete` lo impide y la FK restringe borrar la identidad Auth mientras exista el perfil. La desactivación conserva auditoría e historial.
