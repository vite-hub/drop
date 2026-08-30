---
title: One command for generated ViteHub output
prompt: >-
  generated types and config drift again. can we have one command that updates them and CI tells you when you forgot? check vitehub because maybe half of this already exists. use what we have, no new package unless there is really no way. plan first
---

# One command for generated ViteHub output

Add `vitehub prepare` as the canonical, idempotent way to regenerate local ViteHub types and configuration. Keep `vitehub types prepare` as a compatible alias. No new package is needed.

::callout{type="decision"}
Keep `.vitehub/**` ignored. CI should regenerate output from source and verify the result, not make contributors commit build artifacts.
::

## What already exists

- `packages/cli/src/index.ts` loads the app's Vite or Nuxt config before dispatching a command. That config load already runs each package's generation hooks.
- `packages/vite-hub/src/internal/types.ts` owns `vitehub types prepare` and writes the final `.vitehub/types.d.ts` index.
- `vitehub()` installs the type-index plugin after the package plugins, and the Nuxt module already prepares package declarations before collecting the final index.
- CI checks builds and provider output, but it does not name clean, repeatable local generation as its own contract.

```mermaid
flowchart LR
  Source[Definitions and config] --> Resolve[Resolve Vite or Nuxt config]
  Resolve --> Packages[Package generation hooks]
  Packages --> Output[.vitehub artifacts]
  Output --> Index[Refresh types.d.ts last]
  Index --> Check[Idempotence check]
```

## Changes

1. In `packages/cli/src/index.ts`, recognize `vitehub prepare` before namespace dispatch. Let normal config loading regenerate package output, then delegate the final index write to the existing `types prepare` feature. Update root help and retain the old command as an alias.
2. Add one integration test around the public CLI using temporary Vite and Nuxt fixtures. Assert that representative generated types and config files exist, the aggregate index references them, and a second run produces byte-for-byte identical output. Keep package-specific generation tests where they already live.
3. Add a focused `generated:check` task in the root `vite.config.ts` and run it as a named CI step before type checking. The failure should name the missing or unstable artifact instead of relying on a broad build failure.
4. Update `docs/content/docs/development/cli.md`, `docs/content/docs/development/generated-files.md`, and `packages/vite-hub/README.md` to use `vitehub prepare` for install, editor recovery, and CI. Keep provider output under the existing production-shaped build checks.

## Done when

- A fresh Vite or Nuxt app can regenerate its local ViteHub output with `vitehub prepare`.
- Running the command twice changes nothing on the second run.
- CI fails in the focused generation step when package output or the final type index stops being produced in the required order.
- Existing `vitehub types prepare` users continue to work, and no dependency is added.
