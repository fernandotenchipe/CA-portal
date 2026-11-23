# Conexión PostgreSQL del backend

El backend persistente de `backend/` usa `pg` (`node-postgres`) y un `Pool` compartido por proceso. Está preparado para conexiones PostgreSQL TLS a Supabase. Node.js mantiene y reutiliza las conexiones; `DATABASE_POOL_MAX` limita la cantidad por proceso y debe sumarse al pool de cada instancia del VPS para no superar el límite de conexiones del proyecto.

## Configuración local

1. Copia `backend/.env.example` como `backend/.env`.
2. En Supabase, abre **Project Settings > Database > Connection string** y copia el connection string PostgreSQL en `DATABASE_URL`. Para este VPS persistente usa conexión directa si la red tiene IPv6; si es IPv4-only, usa el Session Pooler.
3. Descarga el certificado CA raíz desde **Database Settings > SSL Configuration**. Guárdalo fuera del repositorio (por ejemplo en un directorio de secretos del equipo o VPS) y define su ruta en `DATABASE_SSL_CA_PATH`. Configura ambos valores localmente; nunca los pegues en chats, commits ni logs. No agregues parámetros `sslmode`, `sslrootcert`, `sslcert` o `sslkey` a `DATABASE_URL`: el backend los elimina para que no puedan sustituir la configuración SSL explícita. `.gitignore` excluye `.env` y certificados `.crt`, `.pem` y `.cer`.

Variables:

- `DATABASE_URL`: connection string privado PostgreSQL de Supabase.
- `DATABASE_SSL_CA_PATH`: ruta al certificado CA raíz descargado de Supabase; es necesaria cuando Node no confía en la CA del servidor. El cliente usa esa CA con `rejectUnauthorized: true` y valida el hostname indicado en `DATABASE_URL`.
- `DATABASE_POOL_MAX`: máximo de conexiones por proceso (por defecto 5).
- `DATABASE_CONNECTION_TIMEOUT_MS`: espera máxima al abrir una conexión (por defecto 10000 ms).
- `PORT`: puerto HTTP actual (por defecto 3001).

El backend se puede iniciar sin abrir una conexión a la base. Para validar credenciales se requiere `DATABASE_URL`; para la cadena autofirmada de Supabase, configura también `DATABASE_SSL_CA_PATH`. La prueba usa exclusivamente `SELECT 1`.

```powershell
cd backend
npm run build
npm run db:check
npm start
```

## Seguridad y responsabilidades

La conexión PostgreSQL y todo secreto de base viven solo en el backend/VPS; no se envían al navegador. Esta conexión no necesita una clave `service_role` de Supabase. La identidad privilegiada de la base no identifica a un trabajador y no reemplaza autorización de API; limitar la futura cuenta PostgreSQL a los grants requeridos por el esquema, sin alterar RLS ni privilegios desde esta fase.

Para cada petición futura, el backend validará el access token Supabase Auth (firma, emisor, audiencia y expiración), resolverá su `sub` a un usuario activo de `public.usuarios` y cargará sus roles/permisos. Cada ruta exigirá el permiso de módulo y acción correspondiente en el servidor, con denegación por defecto. El UUID del actor nunca se acepta del body, query ni headers controlables por el navegador.

Las mutaciones auditadas futuras deben usar una conexión adquirida del pool dentro de una transacción. Después de validar el JWT, fijarán contexto local antes del SQL de negocio, por ejemplo:

```sql
BEGIN;
SELECT set_config('app.actor_tipo', 'usuario', true);
SELECT set_config('app.actor_id', $1, true); -- sub validado del JWT
-- SQL parametrizado de la operación, solo después de comprobar el permiso API
COMMIT;
```

El tercer argumento `true` hace que esos valores apliquen a la transacción y se limpien al confirmar o revertir; no usar `SET` persistente sobre conexiones reutilizadas. Ante cualquier fallo se ejecutará `ROLLBACK`. `public.validar_contexto_actor()` comprueba el formato y que el perfil exista, pero un GUC no autentica al usuario por sí mismo: solo es confiable si el navegador no tiene credenciales PostgreSQL y la API controla la conexión. Operaciones complejas expuestas por funciones deben invocarse dentro de esa misma transacción cuando requieran contexto de auditoría.

## Pendiente para autenticación

- Configurar Supabase Auth y verificación JWT en middleware del backend.
- Resolver el perfil de `public.usuarios` y roles/capacidades desde la base.
- Definir el mapeo de permisos por módulo y aplicar autorización en cada caso de uso.
- Añadir límites de tasa, manejo de expiración/rotación de claves y pruebas de acceso antes de exponer rutas.
- Diseñar servicios y repositorios para clientes, unidades, documentos cortos, órdenes de fabricación y auditoría; ninguno está implementado aquí.
