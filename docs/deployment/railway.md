# Railway Deployment Guide

This document explains how to promote the Messenger webhook gateway to Railway. It covers preparing build artefacts, configuring environment variables, and validating the deployment once the service is live. Phase 4 of the implementation plan will introduce an automated Railway manifest and CI workflow; the checklist below describes the manual process until that automation lands.

## Prerequisites

- Railway account with access to the target project
- [Railway CLI](https://docs.railway.app/develop/cli) `>=3.13`
- Permission to create services and set environment variables within the project
- Redis add-on or managed instance provisioned in the same project (for session storage)

## 1. Pre-deployment verification

Run the quality gates locally before shipping a build. This mirrors the GitHub Actions workflow and prevents broken bundles from reaching production.

```bash
pnpm install
pnpm verify   # lint + typecheck + test
```

If you added new API surface in the SDK, regenerate the Typedoc site so the published docs stay in sync:

```bash
pnpm docs:messaging-sdk
```

## 2. Build artefact (temporary process)

Until the repository ships a production Dockerfile, deploy the TypeScript sources directly with the Railway Node.js runtime:

1. Ensure the workspace root includes the compiled SDK output (the package currently ships TypeScript sources with ESM exports).
2. Set the Railway service start command to:
   ```sh
   pnpm exec tsx apps/messenger-webhook/src/index.ts
   ```
3. Pin the Node version to `20.x` inside Railway so Fastify and the SDK run on the same baseline used in CI.

> Once Phase 4 lands, replace these manual steps with the Docker/CI pipeline documented in `infra/railway/`.

## 3. Configure environment variables

Use the checklist in `infra/railway/README.md` when creating a new environment. At minimum, define the following secrets:

| Variable                  | Notes                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| `FB_APP_SECRET`           | Facebook App secret for verifying webhook signatures.              |
| `FB_PAGE_ACCESS_TOKEN`    | Page token for Messenger Send API responses.                       |
| `FB_WEBHOOK_VERIFY_TOKEN` | Token echoed during Facebook webhook verification.                 |
| `SESSION_STORE_DRIVER`    | Set to `redis` on Railway deployments.                             |
| `REDIS_URL`               | Connection string for the managed Redis instance.                  |
| `AGUI_BASE_URL`           | Base URL for the AG-UI bridge that accepts RunAgentInput payloads. |
| `AGUI_API_KEY`            | Bearer token paired with the AG-UI base URL.                       |

Optional tunables (`WEBHOOK_RATE_LIMIT_MAX`, `WEBHOOK_RATE_LIMIT_WINDOW`, `MESSENGER_MAX_TEXT_LENGTH`, `MESSENGER_TYPING_KEEP_ALIVE_MS`) can be left unset to rely on defaults. Document any overrides in the Railway service description for future operators.

The Railway CLI makes it easy to batch apply variables from a file:

```bash
railway variables set --service messenger-webhook --project <project_id> --env production < .env.production
```

## 4. Provision Redis

If you attach the managed Redis plug-in, Railway exposes the connection string via a generated `REDIS_URL` variable. For external Redis providers, store the URL (with credentials) manually using the command above. The gateway refuses to boot with `SESSION_STORE_DRIVER=redis` when `REDIS_URL` is missing, so set both values together.

## 5. Deploy

1. Link your local checkout to the target project (`railway link`).
2. Push the latest code (`railway up`) or trigger the deployment from the Railway UI.
3. Confirm the logs show `Messenger webhook gateway started` and note the assigned public URL.
4. Configure the Facebook webhook subscription to point at `${RAILWAY_PUBLIC_URL}/webhook`.

## 6. Post-deployment validation

After the service is live:

- Hit `GET ${RAILWAY_PUBLIC_URL}/healthz` to confirm the process responds.
- Send a synthetic POST with a valid signature to `/webhook` and ensure the gateway responds `200`.
- Verify that Redis keys (`messenger:*`) appear when conversations start to confirm session persistence.
- Call `GET ${RAILWAY_PUBLIC_URL}/metrics` and check that Prometheus metrics surface (request counters, latencies, failures).

## 7. Rollback strategy

- Use Railway's deployment history to redeploy a previously healthy build in case of regressions.
- If a secret rotation breaks the service, revert the suspect variable to the last known good value and restart the service via the Railway UI.

## Next steps

Once the automated Railway manifest and CI workflow are ready (Phase 4 scope), replace the manual start command with the container image pipeline and document any changes back in this guide.
