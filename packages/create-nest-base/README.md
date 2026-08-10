# create-nest-base

Create a NestJS project from the nest-base capabilities with npm, pnpm, yarn,
or Bun. The wizard uses one normalized plan for interactive and CI execution.

## Requirements

- Bun `1.3.14` or newer to run the wizard.
- The selected package manager executable must already be available on `PATH`.
- The wizard does not install managers, infer a manager, enable Corepack, or
  convert lockfiles.

The generated project may use any supported manager. On Windows, npm uses the
`npm.cmd` shim.

## Usage

```sh
bunx create-nest-base --help
bunx create-nest-base --target ./my-api
# Interactive defaults to Bun and recommends HTTP Core.
# Select core-crud only to opt out of the optional HTTP Core capability.

# If installation fails, retry the preserved scaffold safely:
bunx create-nest-base --target ./my-api --retry
```

### CI and migration from 0.1.5

CI must provide the manager and capability plan explicitly; omitted managers
are rejected rather than inferred:

```sh
bunx create-nest-base --ci --yes \
  --package-manager pnpm \
  --target ./my-api \
  --select core-crud \
  --core-version 0.1.0 \
  --core-source @nest-base/core@0.1.0 \
  --core-integrity sha512-...
```

Existing CI invocations from `0.1.5` must add `--package-manager`. Selecting
`http-core` also requires its exact source, version, and SHA-512 integrity.
Use `--dry-run` to validate flags without writes or installs.

The package exposes the `create-nest-base` executable and keeps generated-project
dependencies separate from the wizard runtime.

The default core capability is pinned to the verified `@nest-base/core@0.1.0`
registry tarball. The optional logger remains fail-closed: it requires an
explicit artifact source, version, and verified `sha512` integrity before it can
pass the artifact gate; no published logger artifact is claimed by this package.

HTTP Core is optional and recommended, not mandatory. Its interactive default
is enabled only after the release evidence is bound and all packed gates pass;
until then, choose `core-crud` only. Release order and the publication block are
recorded in [`../../docs/create-nest-base-release.json`](../../docs/create-nest-base-release.json).
