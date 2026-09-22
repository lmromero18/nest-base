# `create-nest-base` bootstrap wizard

`create-nest-base` creates one fresh, empty NestJS project from a deterministic,
reviewable plan. It is an orchestration layer: the vanilla project comes from
the pinned Nest CLI, and the selected npm, pnpm, yarn, or Bun manager owns the
final install.

## Quick flow

1. Choose a target and review the capability cards.
2. Resolve prerequisites, sources, versions, and integrity before side effects.
3. Review the normalized preview and explicitly confirm it.
4. Scaffold with `@nestjs/cli@11.0.0`, using `--strict --skip-install --skip-git`.
5. Write owned metadata, run exactly one `<selected-manager> install`, verify, and print the result.

Interactive and CI modes resolve the same normalized plan. CI requires an
explicit target, `--package-manager`, capability selection, sources, exact
versions, and verified SHA-512 integrity. Supported mappings are `npx` + npm,
`pnpm dlx` + pnpm, `yarn dlx` + yarn, and `bunx` + Bun. The selected executable
must be installed on `PATH`; unavailable managers are reported as unavailable
evidence and are never substituted. Use `--dry-run` to inspect a plan without
creating or changing files; use `--yes` only with a complete CI plan.

## Capability cards

| Capability                                                      | Selection             | Meaning                                                                                 |
| --------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `core-crud`                                                     | Mandatory and locked  | Every generated project starts with the CRUD foundation.                                |
| `logger`                                                        | Optional              | Selectable only when its real artifact passes the availability and integrity gates.     |
| `http-core`                                                     | Optional, recommended | Selected by interactive mode only when release evidence is bound; `core-crud` opts out. |
| `websocket`, `events`, `kafka`, `pubsub`, `queues`, `generator` | Visible, unavailable  | Roadmap cards show the concrete reason and cannot be installed.                         |

The wizard does not fabricate package exports. `core-crud` is blocked until a
real `@nest-base/core` artifact and an independent consumer compile/run gate
are available. Logger follows the same artifact contract when selected.

## Artifact and package prerequisites

Registry entries use exact versions and recorded integrity. File and URL
tarballs must identify the expected package/version and match the declared
`sha512-...` SRI. URL redirects, missing integrity, identity mismatches, and
unavailable artifacts fail before confirmation.

The scaffold command skips installation. For file and URL artifacts, the wizard
writes the already verified tarball under `.nest-base/artifacts/` and points the
dependency at that exact local file before invoking exactly one target-CWD
command: `<selected-manager> install`. It never uses one add call per capability.

### Release ordering

Publish and enable the HTTP Core recommended default only after the packed core
consumer, HTTP Core audit, independent ESM/CJS consumers, manager availability
matrix, and packed wizard matrix all pass. The release metadata intentionally
keeps publication blocked until those evidence flags are complete. The required
sequence is core, HTTP Core evidence, then the wizard. See
`create-nest-base-release.json` for the current version and gate state.

## Manifest and package metadata

`.nest-base/manifest.json` is canonical operational state. It records schema
and wizard versions, target identity, registry revision, resolved entries,
dependency sections, owned paths, and SHA-256 hashes.

`package.json.nestBase` is the user-visible mirror with schema `1`:

```json
{
  "schemaVersion": 1,
  "wizardVersion": "0.1.0",
  "manifestPath": ".nest-base/manifest.json",
  "capabilities": []
}
```

The manifest and mirror must agree on capability IDs, versions, sources,
integrity, and model. Dependency sections remain package-manager authority.
Existing root keys are preserved, but conflicting dependency values, unknown
metadata fields, unsupported edits, and mirror mismatch are refused.

## Ownership, reruns, and recovery

The wizard owns `nestBase`, declared dependency keys, `.nest-base/`, and
declared capability outputs only. A matching plan is verify-only/no-op. Changed
selections, sources, versions, registry revision, or owned hashes are drift and
require a future reviewed `add`/`doctor` flow.

On failure, compensation restores only hash-unchanged owned files and removes
only files created by the run. A failed new target is preserved by default;
rerun it with `--retry` to reuse the scaffold without deleting user files.
If another process changes an owned file, rollback reports a leftover and a
recovery diagnostic instead of overwriting that change.

## Generator roadmap

Generator support is future work. When it is eventually enabled, the default
model is `table-crud`; `view` and `read-only` profiles are future options.

## Explicit scope exclusions

This wizard does **not** extract or publish core packages, implement logger
internals, WebSocket/events/Kafka/Pub/Sub/queues, migrations, auth, login,
notifications, health, or the generator. It also does not rewrite arbitrary
projects or provide existing-project `add`/`doctor` commands. Those require
separate designs, ownership contracts, and acceptance gates.
