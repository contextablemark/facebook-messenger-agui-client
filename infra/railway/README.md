# Railway Infrastructure Notes

Phase 0 established this directory so deployment artifacts (`railway.json`, environment documentation, automation scripts) have a consistent home. As the gateway matured, we codified the environment contract below so platform engineers can provision secrets without cross-referencing application source.

## Required Environment Variables

Set these keys on the Railway service before promoting a build. All values should be stored as Railway environment variables (never committed to VCS).

| Variable                  | Purpose                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `FB_APP_SECRET`           | Facebook App secret used to validate `X-Hub-Signature-256` headers.        |
| `FB_PAGE_ACCESS_TOKEN`    | Page access token used for outbound Send API requests.                     |
| `FB_WEBHOOK_VERIFY_TOKEN` | Token echoed during the Facebook webhook verification handshake.           |
| `AGUI_BASE_URL`           | Base URL for the AG-UI agent endpoint that accepts RunAgentInput payloads. |
| `AGUI_API_KEY`            | Bearer token supplied with each AG-UI dispatch request.                    |
| `SESSION_STORE_DRIVER`    | `redis` in Railway so sessions persist across replicas.                    |
| `REDIS_URL`               | Connection string for the Redis instance backing the session store.        |

## Optional Tunables

The runtime exposes several optional settings so operators can adjust throughput and UX without code changes. Define any overrides that differ from the defaults documented here.

| Variable                         | Default      | Description                                                     |
| -------------------------------- | ------------ | --------------------------------------------------------------- |
| `WEBHOOK_RATE_LIMIT_MAX`         | `60`         | Requests allowed during the `WEBHOOK_RATE_LIMIT_WINDOW` window. |
| `WEBHOOK_RATE_LIMIT_WINDOW`      | `"1 minute"` | Fastify-compatible time window string for rate limiting.        |
| `MESSENGER_MAX_TEXT_LENGTH`      | `2000`       | Maximum characters sent in a single Messenger message chunk.    |
| `MESSENGER_TYPING_KEEP_ALIVE_MS` | `5000`       | Interval in milliseconds for refreshing `typing_on` indicators. |

> Tip: Leave these unset to rely on the defaults baked into `apps/messenger-webhook/src/config/env.ts`. When you do override values, capture the rationale in the Railway service description so future operators understand the tuning.

## Secret Template

Use the sample below as a checklist when configuring a new environment. Replace placeholder values with your real secrets.

```ini
# Required secrets
FB_APP_SECRET=replace-with-facebook-app-secret
FB_PAGE_ACCESS_TOKEN=replace-with-facebook-page-token
FB_WEBHOOK_VERIFY_TOKEN=replace-with-facebook-verify-token
AGUI_BASE_URL=https://your-agui-host/agent/messenger-gateway
AGUI_API_KEY=replace-with-agui-api-key
SESSION_STORE_DRIVER=redis
REDIS_URL=redis://:password@redis-host:6379/0

# Optional overrides
# WEBHOOK_RATE_LIMIT_MAX=60
# WEBHOOK_RATE_LIMIT_WINDOW="1 minute"
# MESSENGER_MAX_TEXT_LENGTH=2000
# MESSENGER_TYPING_KEEP_ALIVE_MS=5000
```

Add infrastructure-specific instructions (e.g., Redis provisioning, CI pipelines) alongside this file as they solidify.
