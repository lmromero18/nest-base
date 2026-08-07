# Nest Base package platform

The package platform validates the existing `@nest-base/core` and
`@nest-base/http-core` artifacts without changing package implementation or
controller behavior. Promotion is eligible only when the packed artifacts,
independent consumers, quality checks, and cleanup checks all pass.

## Frozen-install-first combined workflow

Install from the committed lockfile, then run the single combined promotion
entry point:

```bash
bun run install:frozen
bun run audit:promotion
```

`audit:promotion` runs `bun install --frozen-lockfile` first, followed by core
C0-C4 and the HTTP-core build, audit, tarball, and independent-consumer
checkpoints. It stops at the first functional failure and reports the package,
checkpoint, command, and exit status. The frozen install must not rewrite
`bun.lock`, and the root development dependency must remain
`@nest-base/core@0.1.0`.

The individual commands remain available for focused reruns:

```bash
bun run build:core
bun run audit:core
bun run audit:tarball
bun run verify:consumer
bun run build:http-core
bun run audit:http-core
bun run audit:http-core:tarball
bun run verify:http-core:consumer
```

Consumers install the generated tarball in an isolated temporary project and
exercise Node and Bun ESM/CJS loading. Workspace source imports and consumers
that did not install the packed artifact are failures.

## C0-C4 evidence

| Checkpoint | Evidence                                                                     |
| ---------- | ---------------------------------------------------------------------------- |
| C0         | Frozen baseline, readiness tests, status and diff checks                     |
| C1         | Core context and compatibility contract                                      |
| C2         | Core build, exports, declarations, dependency, artifact, and tarball audits  |
| C3         | Independent packed core consumer compiles and runs in Node/Bun ESM/CJS modes |
| C4         | Executable core promotion contract and residue validation                    |

HTTP-core adds its own build, runtime/dependency, packed-tarball, and
independent-consumer evidence after the core checkpoints.

## Promotion eligibility

Promotion is eligible only if the frozen install, every core and HTTP-core
checkpoint, and final residue assertions succeed. A failed build, audit,
tarball, consumer, lockfile check, or quality check makes the run non-zero and
ineligible.

## Cleanup and reruns

Promotion cleanup is bounded and ownership-safe. It removes only declared
package outputs and run artifacts created by the current promotion, runs from
`finally` on success or failure, and fails closed when ownership, liveness, or
absence cannot be proven. Active, unknown, malformed, or unreadable run roots
are retained and reported rather than deleted.

For a focused rerun, remove only artifacts identified by the failed command,
then repeat the command. For the complete acceptance run:

```bash
bun run quality:check
bun run audit:promotion
git diff --check
git status --short
```

After a clean run, no generated `dist`, `.build-work`, `.build-types`, tarball,
consumer, lock, or promotion run residue owned by the workflow may remain.

## Repository quality wiring

The root quality commands retain application coverage for `src`, `test`,
`tools`, and package sources while covering package-platform configuration and
documentation. Use `bun run quality:check` for focused-test guard, lint,
Prettier, TypeScript, and diff validation.

## Package roadmap

| Package/profile                          | Status                        |
| ---------------------------------------- | ----------------------------- |
| `@nest-base/core`                        | Mandatory first package       |
| `@nest-base/http-core`                   | Core NestJS HTTP adapter      |
| `@nest-base/http-fastify`                | Future Fastify adapter        |
| `@nest-base/http-express`                | Future Express adapter        |
| `@nest-base/logger`                      | Optional follow-on            |
| WebSocket, events, Kafka, Pub/Sub, queue | Optional follow-ons           |
| Generator `table-crud`                   | Current compatibility default |
| Generator `view` and read-only profiles  | Future profiles               |

## Scope boundaries

This work unit intentionally excludes controller/README migration, root
metadata cleanup, broad `.vscode` changes, package implementation, publication
automation, live PostgreSQL or migration coverage, promotion-recovery
internals, and no-op `packages/core` status changes. Those concerns require
separate work units and are not evidence of package-platform failure.
