# Repository Guidelines

- Use **pnpm** for all Node.js dependency management and scripts. Do not add `package-lock.json` or `yarn.lock` files.
- Keep shared TypeScript configuration in `tsconfig.base.json` and extend it from workspace packages.
- Prefer TypeScript for new source files. If JavaScript is required, document the reason in code comments.
- Place service applications under `apps/` and reusable libraries under `packages/`. Add or update a local README when creating a new top-level package or app.
- Documentation updates belong under `docs/` unless they are scoped to a specific package, in which case place them beside the code and cross-link from the main docs set.
- When adding scripts, favour `.mjs` or `.ts` modules over shell scripts for cross-platform compatibility unless POSIX shell is strictly necessary.
- Deep reference material for AG-UI lives in the DeepWiki repo `ag-ui-protocol/ag-ui`; fetch protocol details there instead of guessing about the platform contracts.
