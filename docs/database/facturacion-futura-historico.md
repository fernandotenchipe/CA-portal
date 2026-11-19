# Registro histórico: propuesta previa de facturación externa

Esta nota conserva la propuesta original de V4 al mover facturación fuera de las migraciones iniciales. No es un modelo fiscal aprobado y no se debe aplicar en V1.

## Diseño previo conservado como borrador

- `facturas_externas` guardaría un identificador interno UUID.
- La deduplicación tentativa era una clave de emisor más una referencia externa, normalizadas a mayúsculas y sin espacios en extremos.
- `documento_corto_id` sería nullable y UNIQUE: permitiría registrar primero la factura y asociarla después a una hoja; de manera tentativa una hoja tendría como máximo una factura y una factura pertenecería como máximo a una hoja.
- Estado externo `emitida/cancelada`, fecha y observaciones serían referencias; el portal no emitiría CFDI ni ejecutaría cancelación fiscal.

El SQL tentativo está en [202611180007_billing_external_draft.sql](../../supabase/future_migrations/202611180007_billing_external_draft.sql), fuera de `supabase/migrations/` para no integrarlo al orden inicial de Supabase CLI.

## Motivo de aplazamiento

La primera versión solo controla hojas y fabricación. No se ha aprobado la clave real de factura (UUID CFDI, serie/folio u otra), la identidad del emisor ni la cardinalidad final. Si una hoja puede tener pagos o facturas parciales, el vínculo uno-a-uno del borrador no sirve y deberá reemplazarse por asignaciones. El borrador no incluye pagos, anticipos, CFDI ni endpoints.
