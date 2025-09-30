# Facebook Messenger AG-UI Gateway

[![CI](https://github.com/contextablemark/facebook-messenger-agui-client/actions/workflows/ci.yml/badge.svg)](https://github.com/contextablemark/facebook-messenger-agui-client/actions/workflows/ci.yml)

This repository contains the webhook gateway that connects Facebook Messenger to the Agent User Interface (AG-UI) protocol. The service validates incoming Facebook requests, normalises conversation events, forwards them to AG-UI, and delivers assistant responses back through the Messenger Send API with typing indicators, slash-command support, and structured telemetry.

## Repository Structure

```
.
├── apps
│   └── messenger-webhook    # @agui-gw/messenger-webhook Fastify service that bridges Messenger and AG-UI
├── docs                     # Product and implementation plans, reference docs
├── infra                    # Deployment definitions (e.g., Railway)
├── packages
│   ├── core                 # Shared gateway dispatcher built on the AG-UI SDK
│   └── fb-messenger         # SDK shared by gateway and future services
└── .github/workflows        # CI configuration (lint, type-check, tests)
```

## Features

### AG-UI SDK integration

- The gateway now depends on the official AG-UI SDK packages (`@ag-ui/core`, `@ag-ui/client`, `@ag-ui/encoder`, `@ag-ui/proto`) published by the platform team.
- Shared dispatcher logic lives in `@agui-gw/core`, ensuring all applications consume the same request builders and event handlers.

### Messenger gateway highlights

- ✅ Signature verification and webhook verification handshake for Facebook Messenger
- ✅ Normalisation of Messenger events and dispatch to AG-UI via RunAgentInput
- ✅ Slash commands (`/reset`, `/help`, unknown command guidance)
- ✅ Typing indicator keep-alive and `mark_seen` acknowledgement
- ✅ Message chunking to respect Messenger’s 2,000-character limit
- ✅ Prometheus metrics endpoint (`/metrics`) and structured Fastify logging
- ✅ Configurable session storage (in-memory or Redis)

## Getting Started

The full local setup walkthrough lives in `docs/setup/local-development.md`. Quickstart:

1. Install dependencies: `pnpm install`
2. Copy the environment template: `cp .env.example .env`
3. Fill in the Facebook secrets (`FB_APP_SECRET`, `FB_PAGE_ACCESS_TOKEN`, `FB_WEBHOOK_VERIFY_TOKEN`)
4. Start the gateway: `pnpm run dev:webhook`

The process loads `.env`, boots Fastify on `PORT` (defaults to `8080`), and exposes the webhook endpoints immediately. Prefer `pnpm exec tsx --env-file=.env apps/messenger-webhook/src/index.ts` if you need to run the entrypoint manually.

### Runtime surface

- `GET /webhook` – Facebook webhook verification
- `POST /webhook` – Messenger event intake
- `GET /healthz` – Health probe for infra checks
- `GET /metrics` – Prometheus metrics

### Tests & linting

```bash
pnpm test      # Vitest suite
pnpm lint      # ESLint
pnpm format    # Prettier check
```

CI runs lint, type-check, and tests on every push via [GitHub Actions](https://github.com/contextablemark/facebook-messenger-agui-client/actions/workflows/ci.yml).

## Deployment Notes

Follow `docs/deployment/railway.md` and `infra/railway/README.md` when preparing staging or production services on Railway. Configure the environment variables from `.env.example` (or the Railway checklist) before promoting builds.

## Troubleshooting & security

- `docs/troubleshooting/messenger-webhook.md` – common debugging paths for webhook verification, Send API failures, and Redis issues.
- `docs/security-checklist.md` – deployment-time security guardrails covering secrets, networking, and observability.

## Future Enhancements

- Richer AG-UI → Messenger translation once attachment/quick-reply schemas are published
- Integration tests for rate-limiting paths and AG-UI error handling
- Optional OpenTelemetry exporter alongside Prometheus metrics

## Contributing

When touching existing files, bring comments and documentation up to the standards defined in `AGENTS.md`. Use pnpm for all dependency and script management, and ensure CI passes before opening a pull request.

---

Questions or deployment issues? Open an issue here and consult the AG-UI protocol spec for integration details.
