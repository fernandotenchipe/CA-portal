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

La ruta raíz solo confirma que la aplicación inicia. Aún no hay módulos, endpoints, formularios, base de datos, autenticación, permisos, almacenamiento ni conexión con Supabase.

El prototipo HTML original se conserva sin cambios en `referencias/mockup-registro.html`; es una referencia visual y no forma parte de la aplicación.

## Variables locales futuras

`.env.example` es una plantilla sin credenciales. Cuando se configure Supabase, crea `.env.local` a partir de ella y nunca guardes ese archivo en Git; `.gitignore` ya lo excluye.
