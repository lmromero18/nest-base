# create-nest-base

Create a NestJS project from the nest-base capabilities with Bun.

## Requirements

- Bun `1.3.14` or newer.

This package is Bun-native and does not declare Node.js or npm support.

## Usage

```sh
bunx create-nest-base --help
bunx create-nest-base --target ./my-api
# If installation fails, retry the preserved scaffold safely:
bunx create-nest-base --target ./my-api --retry
```

The package exposes the `create-nest-base` executable and keeps generated-project
dependencies separate from the wizard runtime.
