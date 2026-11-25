# Frontend: primera fase visual

## Alcance

La rama `feat/frontend-v2` agrega las pantallas iniciales del portal en Next.js App Router. Incluye inicio de sesión con Supabase Auth, recuperación de contraseña usando la ruta existente `/auth/accept-invite`, un área privada, dashboard y vistas iniciales de Clientes, Unidades, Hojas de trabajo, Órdenes de fabricación y Notificaciones.

Las vistas operativas muestran estados vacíos y controles de alta/filtro deshabilitados. No contienen registros ficticios, operaciones CRUD ni endpoints nuevos. La autorización de datos sigue siendo responsabilidad del backend.

## Autenticación e integración

- Supabase Auth inicia sesión y recupera contraseña en el navegador usando la clave publicable.
- Antes de mostrar el área privada, el frontend envía el access token como `Authorization: Bearer` a `GET /api/auth/check` y `GET /api/auth/me`.
- Next.js reescribe `/backend-api/*` hacia `${BACKEND_API_URL}/api/*`, para mantener las llamadas del navegador same-origin y evitar requerir CORS en el backend.
- El rol y nombre del encabezado se obtienen de `/api/auth/me`. La interfaz no inventa permisos ni oculta módulos basándose en una matriz aún no aprobada.
- La pantalla de recuperación redirige a `/auth/accept-invite`; la lógica de aceptación de invitaciones y validación de callback se conserva.

## Configuración local

Completa `.env.local` a partir de `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
BACKEND_API_URL=http://localhost:3001
```

`BACKEND_API_URL` es una URL, no un secreto. En despliegue debe apuntar al backend alcanzable por el servidor de Next.js. Configura también en Supabase la URL de redirección del sitio para `/auth/accept-invite`.

## Archivos de esta fase

- `src/app/page.tsx`: redirección inicial al dashboard.
- `src/app/layout.tsx`, `src/app/globals.css`: metadatos y sistema visual adaptable.
- `src/app/login/page.tsx`: login y solicitud de recuperación.
- `src/app/(portal)/layout.tsx`: proveedor de autenticación y shell privado.
- `src/app/(portal)/dashboard/page.tsx`: resumen inicial sin métricas ficticias.
- `src/app/(portal)/clientes/page.tsx`, `unidades/page.tsx`, `hojas/page.tsx`, `fabricacion/page.tsx`, `notificaciones/page.tsx`: vistas operativas vacías.
- `src/components/icon.tsx`, `ui.tsx`, `app-shell.tsx`, `portal-auth.tsx`: iconografía, elementos compartidos, navegación y validación de sesión.
- `src/lib/api.ts`, `supabase-browser.ts`: acceso a los endpoints de autenticación existentes y cliente de Supabase.
- `next.config.ts`: proxy same-origin configurable para el backend.
- `.env.example`: variables necesarias para frontend y proxy.

## Compatibilidad y límites

La copia inicial disponible en esta computadora solo tenía una página estática; las pantallas frontend desarrolladas localmente en la computadora principal no estaban en el historial de Git accesible. Esta implementación parte del commit publicado y conserva los archivos de backend, migraciones, pruebas y documentación existentes. No incluye esos cambios locales no sincronizados, por lo que la integración futura debe comparar este branch con la versión de la computadora principal antes de combinar ambos trabajos.

La protección visual de rutas no reemplaza autorización en el servidor. Cuando se agreguen operaciones, cada endpoint de negocio debe autenticar el JWT, comprobar permisos y aplicar las reglas de auditoría aprobadas. No se agregaron rutas de negocio ni se cambió Supabase.
