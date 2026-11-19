# Modelo ER V4 consolidado

**Estado:** propuesta corregida con las decisiones aprobadas del negocio. Migraciones no ejecutadas. Las tablas de facturación quedan fuera del esquema inicial y se conservan como propuesta futura separada.

```mermaid
erDiagram
  ROLES ||--o{ USUARIOS : asigna
  PERMISOS ||--o{ ROL_PERMISOS : concede
  ROLES ||--o{ ROL_PERMISOS : recibe
  CLIENTES ||--o{ UNIDADES : posee
  UNIDADES ||--o{ DOCUMENTOS_CORTOS : identifica
  USUARIOS o|--o{ DOCUMENTOS_CORTOS : registra
  DOCUMENTOS_CORTOS ||--|{ FOLIOS_FISICOS_RESERVADOS : reserva
  DOCUMENTOS_CORTOS ||--o{ TRABAJOS : contiene
  DOCUMENTOS_CORTOS ||--o| ORDENES_FABRICACION : puede_originar
  ORDENES_FABRICACION ||--|{ VERSIONES_FABRICACION : versiona
  VERSIONES_FABRICACION ||--o{ IMPRESIONES : imprime
  DOCUMENTOS_CORTOS ||--o{ EVIDENCIAS : respalda
  USUARIOS o|--o{ AUDITORIA : actua
  AUDITORIA ||--o| NOTIFICACIONES : genera
  NOTIFICACIONES ||--o{ NOTIFICACION_USUARIOS : entrega
  USUARIOS ||--o{ NOTIFICACION_USUARIOS : recibe
  REPORTES_DIARIOS ||--o{ REPORTES_DIARIOS_DESTINATARIOS : envía
  USUARIOS ||--o{ REPORTES_DIARIOS_DESTINATARIOS : recibe

  ROLES {
    uuid id PK
    text codigo UK
    text nombre UK
    boolean activo
  }
  PERMISOS {
    uuid id PK
    text modulo
    text operacion
  }
  ROL_PERMISOS {
    uuid rol_id PK,FK
    uuid permiso_id PK,FK
  }
  USUARIOS {
    uuid id PK,FK
    uuid rol_id FK
    boolean activo
    boolean recibe_reporte_diario
  }
  CLIENTES {
    uuid id PK
    text nombre
    text rfc
    boolean activo
  }
  UNIDADES {
    uuid id PK
    uuid cliente_id FK
    text numero_serie UK
    boolean activo
  }
  DOCUMENTOS_CORTOS {
    uuid id PK
    text folio_fisico
    text folio_fisico_normalizado
    text estado_trabajo
    timestamptz cancelado_en
  }
  FOLIOS_FISICOS_RESERVADOS {
    uuid id PK
    uuid documento_corto_id FK
    text folio_normalizado UK
    boolean es_actual
  }
  TRABAJOS {
    uuid id PK
    uuid documento_corto_id FK
    integer numero_orden
    text estado
    timestamptz finalizado_en
  }
  ORDENES_FABRICACION {
    uuid id PK
    uuid documento_corto_id FK,UK
    bigint folio_digital UK
    text estado
    timestamptz cancelado_en
  }
  VERSIONES_FABRICACION {
    uuid id PK
    uuid orden_fabricacion_id FK
    integer numero_version
    jsonb especificaciones
  }
  IMPRESIONES {
    uuid id PK
    uuid version_fabricacion_id FK
    text estado
    timestamptz solicitada_en
    timestamptz confirmada_en
  }
  EVIDENCIAS {
    uuid id PK
    uuid documento_corto_id FK
    text ruta_storage UK
    timestamptz eliminada_en
  }
  AUDITORIA {
    bigint id PK
    text tipo_actor
    uuid usuario_id FK
    text entidad
    text entidad_id
    jsonb valores_anteriores
    jsonb valores_nuevos
  }
  NOTIFICACIONES {
    uuid id PK
    bigint auditoria_id FK,UK
    text titulo
    text mensaje
  }
  NOTIFICACION_USUARIOS {
    uuid notificacion_id PK,FK
    uuid usuario_id PK,FK
    timestamptz leida_en
  }
  REPORTES_DIARIOS {
    uuid id PK
    date fecha_envio_local UK
    text zona_horaria
    timestamptz periodo_desde
    timestamptz periodo_hasta
    text estado
  }
  REPORTES_DIARIOS_DESTINATARIOS {
    uuid id PK
    uuid reporte_diario_id FK
    uuid usuario_id FK
    text clave_idempotencia UK
    text estado
  }
```

## Entidades iniciales

- **Clientes y unidades:** un cliente puede tener varias unidades. `numero_serie` se almacena una sola vez en mayúsculas, solo con `A-Z` y `0-9`, y tiene UNIQUE global.
- **Documentos y folios:** cada hoja tiene un folio actual y múltiples folios reservados a lo largo de correcciones. La reserva histórica única conserva el valor anterior y evita su reutilización, incluso si el documento se cancela.
- **Trabajos:** conceptos ordenados por documento, con estado de producción `en_construccion` o `finalizado`.
- **Fabricación:** una orden opcional por hoja. El folio digital usa identity. Cada versión guarda un objeto JSONB completo y sus impresiones apuntan a esa versión.
- **Evidencias:** metadatos y ruta privada de Storage. La eliminación es lógica; el objeto binario no se purga automáticamente.
- **Usuarios y acceso:** cada usuario de aplicación corresponde a `auth.users`, pertenece a un rol. Los roles iniciales Administración, Ventas y Logística se cargan como catálogo aprobado; permisos posteriores se asignan por módulo y operación.
- **Auditoría y notificaciones:** todo cambio en las tablas operativas cubiertas requiere contexto de actor y genera auditoría y una notificación general para usuarios activos. La notificación no expone snapshots ni valores sensibles.
- **Reporte diario:** una ejecución lógica por fecha local de envío, 8:00 a. m. de `America/Monterrey`, con ventana del día calendario anterior y resultados por destinatario designado de Administración.

## Estados y finalización

Los únicos estados de producción son `en_construccion` y `finalizado` en hojas, trabajos y órdenes. Finalizar guarda usuario y hora. La hoja puede finalizarse independientemente del estado de sus trabajos y de la orden asociada. Bajo una hoja finalizada, un hijo pendiente puede completar únicamente la transición a `finalizado`; la base rechaza cualquier otro cambio en sus datos. Una dependencia para exigir hijos finalizados antes de cerrar la hoja podría añadirse después si el negocio la solicita y aprueba.

Las solicitudes de impresión (`solicitada`, `confirmada`, `fallida`, `cancelada`) y ejecuciones de correo (`pendiente`, `procesando`, `completado`, `fallido`) son estados técnicos, no etapas de producción.

## Facturación futura

`facturas_externas` no está en este diagrama ni en la secuencia inicial. Su borrador tentativo se guarda en `supabase/future_migrations/` y su relación hoja-factura no está aprobada como regla fiscal.
