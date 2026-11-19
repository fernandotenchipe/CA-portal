# Revisión técnica — consolidación V4

**Resultado:** propuesta revisada estáticamente, pero no validada en PostgreSQL ni lista para implementación. El motor PostgreSQL no estuvo disponible en este entorno, así que no se afirma que el SQL haya pasado pruebas de ejecución.

## Esquema inicial propuesto

Son 18 tablas iniciales:

1. `roles`
2. `permisos`
3. `rol_permisos`
4. `usuarios`
5. `clientes`
6. `unidades`
7. `documentos_cortos`
8. `folios_fisicos_reservados`
9. `trabajos`
10. `ordenes_fabricacion`
11. `versiones_fabricacion`
12. `impresiones`
13. `evidencias`
14. `auditoria`
15. `notificaciones`
16. `notificacion_usuarios`
17. `reportes_diarios`
18. `reportes_diarios_destinatarios`

`facturas_externas` queda en un SQL borrador fuera de la secuencia inicial. No forma parte de V1.

## Correcciones principales frente al V4 anterior

| Hallazgo / contradicción | Corrección incorporada |
|---|---|
| Serie previa permitía espacios y guiones después de normalizar. | Serie se almacena una vez en mayúscula y CHECK solo permite `A-Z0-9`; UNIQUE global. Front/servidor aplicarán doble captura y validación coincidente. |
| Folio previo eliminaba guiones significativos y bloqueaba cualquier corrección. | Formato conserva letras, números y guiones; la comparación quita espacios y usa mayúsculas. Tabla de reserva UNIQUE conserva cada folio, y trigger hace reserva/corrección atómicamente; permisos directos sobre tabla histórica revocados. |
| Estados `borrador/activa/completada` no reflejaban lo aprobado. | Hojas, trabajos y órdenes usan solo `en_construccion/finalizado`. Finalización almacena usuario/hora y bloquea mutación normal; cancelación es metadato separado. |
| Versión podía modificarse o borrarse y concurrentes podían obtener número duplicado. | Append-only trigger y bloqueo de la fila de orden en funciones de versionado; orden inicia con V1; `UNIQUE(orden,numero_version)` es última defensa. RPC excepcional requiere motivo y solo `service_role`. |
| Auditoría permitía usuario vacío y `app.actor_id` podía provenir de petición arbitraria. | Contexto obligatorio usuario/sistema; usuario debe existir, el trigger falla si falta/malformado; los snapshots quedan append-only. Backend deriva el UUID de JWT validado y fija el GUC dentro de transacción controlada. |
| Notificación podía exponer historial o no tener destinatario individual. | Trigger de auditoría crea resumen general sin snapshots y filas individuales para todos los usuarios activos. Auditoría queda sin política de acceso directo; backend filtra detalle a Administración. Realtime sigue futuro. |
| Migración inicial incluía facturas 1:1 sin decisión fiscal y parte de V1. | Se quitó de migraciones raíz. Existe borrador en `supabase/future_migrations/` para conservar idea anterior y futura revisión. |
| Reporte no especificaba zona/rango ni clave por destinatario. | Hora 08:00 y zona `America/Monterrey`; SQL comprueba ventana del día anterior; ejecución única por fecha, destinatario único, clave idempotente y resultado/reintentos. |

## Relaciones y restricciones clave

- Cliente 1:N unidades; una hoja requiere una unidad existente. Unidad/serie no nula.
- Hoja 1:N trabajos; los renglones conservan posición única.
- Hoja 0:1 orden larga. V1 se crea al insertar orden; cada revisión es snapshot completo en JSONB.
- Hoja 1:N evidencias con referencia única a objeto Storage; no guardar binarios/URLs públicas.
- Usuarios N:1 rol; rol N:M permisos. Los tres roles confirmados se siembran; solo `ADMINISTRACION` recibe `auditoria.consultar`.
- Reportes se asignan a usuarios activos designados de Administración; una fila por fecha local y una por destinatario.
- No hay `ON DELETE CASCADE`; históricos clave no se borran físicamente.

## Seguridad de funciones y RLS

- Funciones `SECURITY DEFINER` usan `search_path` fijo; sus privilegios de ejecución se revocan a `PUBLIC`, `anon` y `authenticated`. Solo los RPC de versión se conceden a `service_role`.
- Versiones no admiten DML directo desde roles de cliente ni service role; folios reservados solo se consultan desde servicio y se escriben desde trigger. Auditoría solo tiene SELECT para servicio; no tiene UPDATE/DELETE.
- Todas las tablas públicas iniciales habilitan RLS sin políticas. Acceso `anon/authenticated` queda denegado. `service_role` ignora RLS, así que la futura API debe verificar usuario/permiso para toda operación y solo permitir auditoría detallada a Administración.
- GUC `app.actor_id` no es una credencial criptográfica. Es seguro solo si el navegador no tiene conexión SQL ni service role. La futura implementación debe ejecutar cada mutación en transacción PostgreSQL que establece `app.actor_tipo`, `app.actor_id` y correlación después de Auth; separado por llamadas REST no conserva `SET LOCAL`.
- Las excepciones de versionado quedan en una función separada, requieren motivo, actor de usuario activo y generan auditoría/notificación. La autorización de permiso de excepción sigue siendo chequeo de backend; el secret `service_role` no se expone.

### Estrategia de autorización para el backend VPS

El backend es el único componente que recibirá la clave `service_role` o credenciales PostgreSQL privilegiadas. El frontend Vercel solo conserva credenciales publicables y envía el access token Supabase al backend. No debe existir acceso directo del navegador a las tablas.

Para cada petición, el backend debe:

1. Verificar criptográficamente el access token con Supabase Auth/JWKS y obtener el `sub` validado; nunca aceptar `usuario_id`, rol o permiso desde el body o headers arbitrarios.
2. Cargar `public.usuarios` por ese `sub`, rechazar perfiles inexistentes/inactivos y resolver rol y `rol_permisos` desde PostgreSQL. Denegar por defecto si no existe el permiso exacto del módulo/operación.
3. Aplicar una comprobación de autorización en cada lectura y mutación. Para auditoría detallada, exigir además `auditoria.consultar` y que el usuario pertenezca a `ADMINISTRACION`; las notificaciones solo entregan sus resúmenes autorizados.
4. En mutaciones auditadas, abrir una transacción y configurar `app.actor_tipo='usuario'` y `app.actor_id=<sub validado>` con `SET LOCAL`/`set_config(..., true)` antes de ejecutar SQL parametrizado. Hacer commit solo si termina toda la mutación; usar rollback ante error. Esto mantiene el contexto aislado por transacción en un pool.
5. Mantener tokens Supabase, `service_role` y contraseña PostgreSQL solo en secretos del VPS; rotarlos si se exponen y restringir red/egress de la base al backend y herramientas administrativas.

RLS habilitado sin policies y los `REVOKE` bloquean el Data API para `anon`/`authenticated`; `service_role` deliberadamente omite RLS y puede leer/escribir la mayoría de tablas. Es una identidad técnica privilegiada, no una identidad de trabajador. Las funciones RPC concedidas a `service_role` tampoco sustituyen el chequeo de permisos del API. El starter actual en `backend/` no tiene Auth middleware, conexión a DB ni autorización: esta sección es el diseño requerido, no una implementación ya activa.

### Bootstrap de la primera cuenta de Administración

El primer perfil `public.usuarios` no puede atribuirse a un usuario de aplicación que todavía no existe. La inicialización local debe crear primero una identidad en Supabase Auth y después insertar el perfil dentro de una transacción administrativa aislada con `app.actor_tipo='sistema'` y `app.actor_id` vacío. El trigger deja una fila de auditoría explícita como sistema, nunca un actor nulo de tipo usuario. Este procedimiento no debe exponerse como endpoint público ni reutilizarse para altas ordinarias. El paso está descrito con SQL en `guia-pruebas-local-supabase.md`.

## Limitaciones y riesgos que quedan

1. **Consecutivo digital:** identity permite gaps. No se eligió política gapless.
2. **GUC de actor:** requiere una conexión transaccional controlada o funciones RPC de mutación; patrón exacto y dependencia Node PostgreSQL deben confirmarse antes de backend funcional.
3. **Permisos por módulo:** roles están precargados pero matriz de operaciones Ventas/Logística/Administración sigue pendiente. Los triggers SQL no sustituyen autorización de API.
4. **Reapertura/cancelación:** no hay endpoint ni función de reapertura; cancelación se conserva y SQL deja posible limpiar campos, auditándolo. Política final pendiente.
5. **Evidencias:** objeto de Storage no comparte transacción; baja lógica no borra el binario. Retención/restauración pendiente. Falta bucket y policies privados.
6. **Notificaciones:** persistencia y destinatarios activos están; no hay Realtime, canal ni policy que controle subscription. Cuerpo es genérico por seguridad.
7. **Correo:** estructura idempotente reduce duplicados; exactamente una entrega depende del proveedor y soporte de clave idempotente. Cron/provider no configurados.
8. **JSONB:** SQL asegura que es objeto, no que cada clave técnica sea correcta. Validación de plantilla está pendiente.
9. **Facturas:** el draft contiene una cardinalidad uno-a-uno tentativa; si luego se decide parcial/múltiple, se modelará una asignación y no se aplicará el draft tal cual.

La finalización agregada de la hoja (esperar a que todos los trabajos y la orden estén finalizados) no está aprobada y no es una restricción del SQL actual. Puede evaluarse como cambio futuro si el negocio lo solicita.

Al permitir finalizar la hoja sin esperar a sus hijos, un trabajo u orden pendiente ahora admite únicamente su transición a `finalizado` bajo la hoja finalizada. El trigger compara el resto de la fila y rechaza diferencias en cualquier otro dato, exige actor usuario y deja el cambio bajo auditoría.

## Orden de migraciones

Aplicar solamente en un entorno aislado después de revisar:

1. `202611180001_core.sql` — roles, permisos, usuarios, clientes, unidades y contexto de actor.
2. `202611180002_documents.sql` — hojas, reservas de folios, trabajos.
3. `202611180003_fabrication.sql` — órdenes, primera versión, versiones e impresiones.
4. `202611180004_evidences.sql` — metadatos de evidencias.
5. `202611180005_audit_notifications_reports.sql` — integridad de estados, auditoría/notificaciones y reportes.
6. `202611180006_rls_baseline.sql` — cierre RLS, sin policies.

El borrador `supabase/future_migrations/202611180007_billing_external_draft.sql` **no lo recoge Supabase CLI como migración inicial**, no se ejecutará al aplicar la carpeta `migrations/`, y solo se revisa cuando facturación se apruebe.

## Validaciones ejecutadas

- Revisión estática del orden `001_core`, `002_documents`, `003_fabrication`, `004_evidences`, `005_audit_notifications_reports`, `006_rls_baseline`; las referencias públicas apuntan a las 18 tablas declaradas en el conjunto.
- Revisión de restricciones UNIQUE/FK/CHECK, triggers, grants/revokes, `SECURITY DEFINER`, RLS y posibles carreras.
- Comprobación de que no hay `ON DELETE CASCADE`, policies no aprobadas ni archivos sensibles en estos cambios.
- Escaneo estático de los archivos SQL/Markdown: sin marcadores de conflicto, espacios finales ni delimitadores de funciones desbalanceados. Se añadió suite pgTAP, no ejecutada.
- No se encontró `psql`, `pg_format`, `sqlfluff`, instalación de PostgreSQL ni servicio local. Docker CLI está instalado, pero su motor no está activo; `docker desktop start` falló al intentar crear su log local y `docker info` no pudo conectarse al daemon.
- Se preparó una suite pgTAP de 64 aserciones en `supabase/tests/database/v4_integrity.test.sql` y dos escenarios manuales de dos sesiones para carreras de folio/versionado. No se ejecutó ninguna migración ni prueba funcional. La suite queda sin probar en motor; toda la integridad, concurrencia, auditoría y seguridad aún requiere ejecución en PostgreSQL aislado.
