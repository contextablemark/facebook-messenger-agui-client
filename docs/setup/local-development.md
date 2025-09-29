# Local Development

This guide walks through configuring the Messenger webhook gateway on a developer workstation. It assumes you are building against the pnpm workspace in this repository and want to exercise the Fastify service end-to-end against the Facebook webhook contract and AG-UI dispatcher.

## Prerequisites

- Node.js 18.17 or newer (`node --version` to confirm)
- pnpm 8 or newer (`pnpm --version` to confirm)
- Facebook App credentials (App Secret, Page Access Token, Verify Token)
- Optional: Redis 6+ if you want to exercise the Redis session store implementation
- Optional: An HTTPS tunnelling tool such as ngrok when testing Facebook webhook callbacks locally

## 1. Install dependencies

Clone the repository and install workspace dependencies. pnpm will hoist shared tooling (ESLint, Vitest, Typedoc, etc.) into a single lockfile so all packages resolve consistently.

```bash
pnpm install
```

## 2. Configure environment variables

Copy the template environment file and populate the required values. The template describes every variable in more detail.

```bash
cp .env.example .env
```

At minimum you must provide the Facebook secrets listed below. The AG-UI variables are optional until you want the gateway to call a live AG-UI endpoint.

| Variable                  | Required | Notes                                                                 |
| ------------------------- | -------- | --------------------------------------------------------------------- |
| `FB_APP_SECRET`           | ✅       | Used to validate `X-Hub-Signature-256` HMAC headers on webhook calls. |
| `FB_PAGE_ACCESS_TOKEN`    | ✅       | Allows the gateway to send messages via the Messenger Send API.       |
| `FB_WEBHOOK_VERIFY_TOKEN` | ✅       | Echoed back during `GET /webhook` verification requests.              |
| `AGUI_BASE_URL`           | ▫️       | Base URL for the AG-UI run bridge; omit to disable outbound dispatch. |
| `AGUI_API_KEY`            | ▫️       | Bearer token for AG-UI requests when `AGUI_BASE_URL` is set.          |
| `SESSION_STORE_DRIVER`    | ▫️       | `memory` (default) or `redis`.                                        |
| `REDIS_URL`               | ▫️       | Required only when `SESSION_STORE_DRIVER=redis`.                      |

Refer to `infra/railway/README.md` for the production/staging environment contract once you prepare hosted deployments.

## 3. Launch the gateway

Start the service with the workspace script:

```bash
pnpm run dev:webhook
```

The script wraps `pnpm exec tsx --env-file=.env apps/messenger-webhook/src/index.ts`, compiling the TypeScript sources on the fly and starting Fastify on the configured `PORT` (default `8080`). Use the explicit `pnpm exec tsx ...` form if you want to customise CLI arguments.

Fastify logs the bound port on startup. Expose the `/webhook` endpoint publicly (e.g., via ngrok) when testing Facebook callbacks. The gateway also exposes:

- `GET /healthz` for liveness probes
- `GET /metrics` for Prometheus scraping

Stop the process with `Ctrl+C`. The shutdown hook flushes pending Redis connections when the session store driver is set to `redis`.

## 4. Run the test suite

Run the Vitest suite to validate SDK utilities and ensure lint/type-check scripts remain green before committing changes.

```bash
pnpm test
pnpm lint
pnpm typecheck
```

Use `pnpm test:watch` while iterating on tests locally.

## 5. Optional: exercise the Redis session store

To validate the Redis-backed session store locally:

1. Start a Redis instance (Docker example below).
   ```bash
   docker run --rm -it -p 6379:6379 redis:7-alpine
   ```
2. Set `SESSION_STORE_DRIVER=redis` and `REDIS_URL=redis://localhost:6379/0` in `.env`.
3. Relaunch the gateway. The application logs a confirmation when the Redis client connects successfully.

## Next steps

- Follow the deployment guide in `docs/deployment/railway.md` to promote the service onto Railway.
- Review `docs/troubleshooting/messenger-webhook.md` if you encounter signature or connectivity errors during local testing.
