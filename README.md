# Carrocerías Aguirre

Base inicial del sistema web interno para Carrocerías Aguirre.

## Tecnologías preparadas

- Next.js 16 con App Router
- React 19 y TypeScript
- Tailwind CSS 4
- ESLint y comprobación de tipos

La estructura reserva espacios para shadcn/ui, React Hook Form, Zod y Supabase. Esas dependencias y sus integraciones se agregarán cuando se autorice su uso.

## Requisitos

- Node.js 20.9 o posterior
- npm

## Comandos

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm start
```

## Alcance de esta base

La interfaz raíz solo confirma que Next.js inicia y aún no consume APIs. El backend separado en `backend/` cuenta con su conexión PostgreSQL preparada y una comprobación `SELECT 1`; todavía no tiene autenticación, permisos, endpoints de negocio, almacenamiento ni operaciones del sistema. Consulta [la guía de conexión del backend](docs/backend/conexion-postgresql.md).

El prototipo HTML original se conserva sin cambios en `referencias/mockup-registro.html`; es una referencia visual y no forma parte de la aplicación.

## Variables locales futuras

Las plantillas `.env.example` no contienen credenciales. Para PostgreSQL, copia `backend/.env.example` a `backend/.env` y configura allí el connection string privado; `.gitignore` excluye los archivos `.env`.
