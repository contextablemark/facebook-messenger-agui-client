# Repository Guidelines

- Use **pnpm** for all Node.js dependency management and scripts. Do not add `package-lock.json` or `yarn.lock` files.
- Keep shared TypeScript configuration in `tsconfig.base.json` and extend it from workspace packages.
- Prefer TypeScript for new source files. If JavaScript is required, document the reason in code comments.
- Place service applications under `apps/` and reusable libraries under `packages/`. Add or update a local README when creating a new top-level package or app.
- Documentation updates belong under `docs/` unless they are scoped to a specific package, in which case place them beside the code and cross-link from the main docs set.
- When adding scripts, favour `.mjs` or `.ts` modules over shell scripts for cross-platform compatibility unless POSIX shell is strictly necessary.
- Deep reference material for AG-UI lives in the DeepWiki repo `ag-ui-protocol/ag-ui`; fetch protocol details there instead of guessing about the platform contracts.
- Every source file must include clear, descriptive comments (module headers, class/function docblocks, tricky logic) that explain intent, inputs, and side effects to engineers who might not be familiar with the underlying frameworks. When you modify code, improve the surrounding documentation to meet this bar.
- Workspace package directories must mirror the published scope names (e.g. `packages/core` → `@agui-gw/core`, `packages/fb-messenger` → `@agui-gw/fb-messenger`). Place package-specific tests under `packages/<name>/tests` so production source trees stay lean.
- Regenerate the FB Messenger SDK documentation with `pnpm docs:fb-messenger` whenever the public API changes and commit the generated files under `docs/reference/fb-messenger`.
- Keep Fastify and its plugins on the latest compatible releases to avoid deprecated APIs (e.g. prefer `request.routeOptions.config`—upgrade plugins like `@fastify/helmet` when warnings surface).
