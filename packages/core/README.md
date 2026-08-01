# @nest-base/core

The mandatory Nest Base foundation package exposes TypeORM-aware CRUD services,
query contracts, application errors, and neutral request context contracts.

`CrudControllerFactory` remains an application HTTP adapter and is intentionally
not part of this package's public manifest.

## Install from Bun

```bash
bun add @nest-base/core
```

The consumer owns the supported `typeorm` and `reflect-metadata` peer
dependencies. `CrudControllerFactory` remains an application adapter.

## Promotion gates

Before promotion, run `bun run build:core`, `bun run audit:core`,
`bun run audit:tarball`, and `bun run verify:consumer`. The tarball gate checks
the sorted `npm pack --dry-run` list and rejects source, tests, secrets,
application paths, lockfiles, TypeScript, and forbidden bundled dependencies.
The consumer gate creates a separate temporary project with its own manifest,
installs only the packed core artifact, compiles, and executes representative
Node ESM/CJS and Bun API checks. A missing artifact or unavailable execution
fails closed; no fixture package or repository-source import is accepted.

See `docs/npm-package-platform.md` for migration checkpoints, rollback scope,
and the optional-package roadmap.
