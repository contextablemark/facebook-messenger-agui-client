# Messenger Webhook Gateway

The Messenger webhook gateway is a Fastify application that validates Facebook webhook calls, normalises payloads via `@agui/messaging-sdk`, and forwards structured events into AG-UI run workflows. Phase 2 introduces the production-ready skeleton so that additional capabilities (session persistence, slash commands, Railway deployment) can be layered in the following iterations.

## Runtime Components

- **Fastify server** – exposes public webhook endpoints and an internal health probe, manages lifecycle hooks, and hosts shared plugins (logging, metrics, rate limiting).
- **Messenger guard** – verifies `X-Hub-Signature-256` headers with the Facebook App secret before any payload processing occurs.
- **Event normaliser** – converts Messenger payloads to `NormalizedMessengerEvent` objects using the Phase 1 SDK helpers.
- **AG-UI dispatcher** – adapts normalised events into AG-UI run invocations (exact contract defined in the AG-UI protocol spec). Outbound responses flow back through the Messenger Send API helper in the SDK.
- **Session store abstraction** – in-memory store for local use and Redis-backed implementation for Railway deployments, enabling slash commands and idempotency guarantees.
- **Telemetry** – structured logging through Pino and a Prometheus metrics registry for request volume, latency, and failure counts.

## HTTP Surface

| Method | Path       | Description                                                                                                                 |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/webhook` | Facebook subscription verification. Validates `hub.mode/verify_token` and echoes the challenge on success.                  |
| POST   | `/webhook` | Primary intake for Messenger events. Verifies signatures, normalises payloads, dispatches to AG-UI, enqueues Send API work. |
| GET    | `/healthz` | Liveness endpoint for Docker Compose, Railway health checks, and CI smoke tests.                                            |

## Configuration Surface

Environment variables (subject to refinement once AG-UI docs are confirmed):

- `PORT` – HTTP port, defaults to `8080`.
- `FB_APP_SECRET` – Facebook App secret for signature verification.
- `FB_PAGE_ACCESS_TOKEN` – token used for Send API calls.
- `FB_WEBHOOK_VERIFY_TOKEN` – pre-shared token for the GET verification handshake.
- `AGUI_BASE_URL` – base URL for AG-UI run API.
- `AGUI_API_KEY` – credential used to authenticate outbound AG-UI requests.
- `SESSION_STORE_DRIVER` – `memory` (default) or `redis`.
- `REDIS_URL` – connection string used when the Redis driver is enabled.
- `WEBHOOK_RATE_LIMIT_MAX` / `WEBHOOK_RATE_LIMIT_WINDOW` – optional overrides for request throttling.
- `MESSENGER_MAX_TEXT_LENGTH` – cap for outbound message chunks (defaults to 2000 characters).
- `MESSENGER_TYPING_KEEP_ALIVE_MS` – interval in milliseconds used to refresh typing indicators.

## Module Layout

```
apps/messenger-webhook/src
├── config            # Env schema + application settings
├── server            # Fastify instance factory and lifecycle wiring
├── routes            # Handlers for webhook + health endpoints
├── services          # AG-UI dispatcher, session store drivers, Send API orchestrators
├── telemetry         # Logger and metrics helpers
└── index.ts          # Program entry (CLI bootstrap for local dev / Railway)
```

## Next Steps

1. Validate the AG-UI streaming response handling and surface actionable status/log events to Messenger clients.
2. Build slash command handling and outbound Send API flows that leverage the session store scaffolding.
3. Wire the gateway into Docker Compose and Railway manifests, including Redis provisioning for non-memory deployments.
4. Extend test coverage to the Fastify routes (verification handshake, metrics surfacing, and failure modes).
