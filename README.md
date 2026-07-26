# CENSO-API-PUBLICO

API de consulta pública para el sistema CENSO.

## Repositorio

```text
https://github.com/lmromero18/nest-base
```

## Stack

- NestJS 11
- TypeScript
- TypeORM
- PostgreSQL
- Jest
- pnpm

## Configuración

Copiar el archivo de variables de entorno y ajustar los valores según el ambiente:

```bash
cp .env.example .env
```

El nombre de la aplicación debe mantenerse como:

```env
APP_NAME=NEST-BASE
```

## Instalación

```bash
pnpm install
```

## Ejecución

```bash
pnpm start:dev
```

## Scripts útiles

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
```
