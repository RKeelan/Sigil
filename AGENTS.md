# AGENTS.md

Sigil is a live-preview Markdown editor component built on CodeMirror 6, independent of any host application. `README.md` describes it, and `docs/design.md` holds the design; read the design before changing anything substantial.

## Commands

- `bun install`: install dependencies
- `bun run lint`: lint with Biome
- `bun run lint:pkg`: check that `package.json` pins every dependency
- `bun fmt`: format; `bun fmt --check` checks without writing
- `bun check`: type check
- `bun test`: run the unit tests, which fail below 75% line or function coverage
- `bun run build:demo`: build the demo page, `dist/demo/index.html`
- `bun run test:e2e`: run the end-to-end tests, which drive the built demo page with Playwright

## Testing

Unit tests sit beside the code as `*.test.ts` and run against a DOM with no layout, so they check structure and text. Anything that depends on how the page is laid out or painted is tested end to end, in `e2e/*.e2e.ts`. Rebuild the demo page before running the end-to-end tests, which test the built file.

## Dependency policy

All dependencies are pinned to exact versions. Do not use version ranges (`^`, `~`, `>=`). `exact = true` in `bunfig.toml` makes `bun add` write exact versions, and `npm-package-json-lint` enforces the policy in CI. Dependabot handles upgrades.

## Public repository

This repository is public. Write for any developer, and refer to roles ("the developer", "the user") rather than to people. Keep working notes, agent plans and handoffs out of it, along with private information such as local paths, machine names and email addresses.
