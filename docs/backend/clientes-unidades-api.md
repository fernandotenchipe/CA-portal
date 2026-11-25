# API de Clientes y Unidades

Esta API pertenece al backend Node.js independiente del frontend. Todas las rutas requieren un bearer JWT válido de Supabase y un perfil activo. El backend obtiene el actor del token validado; no acepta identidad de actor en el cuerpo.

## Rutas

Todas las respuestas son `application/json`. Listados devuelven `{ data, limit, offset, total }`; detalle y escrituras devuelven `{ data }`.

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/clientes` | `clientes.consultar` |
| POST | `/api/clientes` | `clientes.crear` |
| GET | `/api/clientes/:id` | `clientes.consultar` |
| PATCH | `/api/clientes/:id` | `clientes.editar` |
| GET | `/api/clientes/:id/unidades` | `unidades.consultar` |
| GET | `/api/unidades` | `unidades.consultar` |
| POST | `/api/unidades` | `unidades.crear` |
| GET | `/api/unidades/:id` | `unidades.consultar` |
| PATCH | `/api/unidades/:id` | `unidades.editar` |

Los listados aceptan `q`, `activo=true|false`, `limit` (1–100) y `offset`. Las unidades aceptan además `cliente_id` y `numero_serie` para búsqueda exacta; no se pueden combinar `numero_serie` y `q`. `q` busca en los campos descriptivos del recurso.

## Campos y reglas

Los campos corresponden a las tablas existentes, sin columnas nuevas:

- Cliente: `nombre` (obligatorio), `razon_social`, `rfc`, `correo`, `telefono`, `activo`.
- Unidad: `cliente_id` (obligatorio al crear), `numero_serie` y `numero_serie_confirmacion` (obligatorios al crear), `marca`, `modelo`, `anio`, `placas`, `activo`.

La confirmación de serie solo es dato de entrada y nunca se persiste. Ambas capturas se validan en el servidor, aceptan únicamente ASCII A–Z/a–z y 0–9, se convierten a mayúsculas y deben coincidir. Cambiar la serie en PATCH requiere ambas capturas. La serie debe ser única globalmente; el índice único existente en PostgreSQL es la protección definitiva ante concurrencia.

El nombre del cliente es obligatorio. Correo usa validación sintáctica básica; `anio` debe estar entre 1886 y 2200, conforme al CHECK existente. RFC/correo/teléfono no tienen restricción de unicidad en el esquema. Como regla temporal de API, RFC no vacío se compara sin distinguir mayúsculas ni espacios externos, serializa sus escrituras concurrentes con un advisory lock y responde `409 duplicate_rfc` si ya está registrado. Esta regla no protege escrituras ajenas a esta API; debe confirmarse antes de consolidarla como regla de negocio.

La relación `cliente_id` de una unidad se establece al crear y no puede cambiarse por PATCH en esta fase para evitar reasignaciones históricas sin una regla de negocio aprobada.

## Autorización y auditoría

Se agregaron las claves de permiso para las seis operaciones de lectura/escritura. En la matriz consultada, los roles `ADMINISTRACION`, `VENTAS` y `LOGISTICA` no tenían asignaciones para `clientes` ni `unidades`. La matriz aprobada concede consultar/crear/editar a esos tres roles. El backend deniega explícitamente estas claves a cualquier rol distinto y también exige el permiso individual en cada endpoint. La propuesta SQL está en `supabase/patches/202611250001_clientes_unidades_permissions.sql`; no se ejecutó. Hasta que se aplique, los tres roles responderán `403 permission_denied` porque PostgreSQL aún no devuelve sus asignaciones.

Las altas y modificaciones usan `withActorTransaction`, que establece el actor validado en la transacción. Los triggers de auditoría existentes en ambas tablas registran las escrituras. Los endpoints no implementan borrado físico.

## Errores comunes

- `401`: falta JWT o no es válido.
- `403`: perfil inactivo o permiso insuficiente.
- `404`: cliente o unidad inexistente.
- `409`: RFC temporalmente duplicado o número de serie duplicado.
- `422`: campo obligatorio o formato/regla de entrada inválidos.

Los mensajes de error de PostgreSQL se traducen a respuestas públicas acotadas; no se devuelven SQL ni detalles de conexión.

## Integración frontend

Enviar `Authorization: Bearer <access_token>` y `Content-Type: application/json` en escrituras. Crear cliente con `POST /api/clientes`; crear unidad con `POST /api/unidades` y enviar dos capturas de serie. Usar permisos recibidos desde `/api/auth/me` para habilitar acciones en interfaz, manteniendo siempre la autorización del servidor como control definitivo. La capa frontend puede consumir las respuestas `{data}` y `{data,limit,offset,total}` descritas arriba. El backend sigue desacoplado y no requiere cambios al frontend para compilar.
