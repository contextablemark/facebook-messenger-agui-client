# Facebook Messenger AG-UI Gateway

[![CI](https://github.com/contextablemark/facebook-messenger-agui-client/actions/workflows/ci.yml/badge.svg)](https://github.com/contextablemark/facebook-messenger-agui-client/actions/workflows/ci.yml)

This repository contains the webhook gateway that connects Facebook Messenger to the Agent User Interface (AG-UI) protocol. The service validates incoming Facebook requests, normalises conversation events, forwards them to AG-UI, and delivers assistant responses back through the Messenger Send API with typing indicators, slash-command support, and structured telemetry.

## Repository Structure

```
.
├── apps
│   └── messenger-webhook    # Fastify service that bridges Messenger and AG-UI
├── docs                     # Product and implementation plans, reference docs
├── infra                    # Deployment definitions (e.g., Railway)
├── packages
│   └── messaging-sdk        # SDK shared by gateway and future services
└── .github/workflows        # CI configuration (lint, type-check, tests)
```

## Features

- ✅ Signature verification and webhook verification handshake for Facebook Messenger
- ✅ Normalisation of Messenger events and dispatch to AG-UI via RunAgentInput
- ✅ Slash commands (`/reset`, `/help`, unknown command guidance)
- ✅ Typing indicator keep-alive and `mark_seen` acknowledgement
- ✅ Message chunking to respect Messenger’s 2,000-character limit
- ✅ Prometheus metrics endpoint (`/metrics`) and structured Fastify logging
- ✅ Configurable session storage (in-memory or Redis)

## Getting Started

### Prerequisites

- Node.js ≥ 18.17
- pnpm ≥ 8
- Facebook App credentials (App Secret, Page Access Token, Verify Token)
- (Optional) Redis instance for production session storage

### Installation

```bash
pnpm install
```

### Environment

Copy `.env.example` to `.env` and populate the required variables:

```bash
cp .env.example .env
```

Key variables include:

- `FB_APP_SECRET` – Messenger App secret used for signature validation
- `FB_PAGE_ACCESS_TOKEN` – Page token used for Send API calls
- `FB_WEBHOOK_VERIFY_TOKEN` – Verification token for the GET `/webhook` handshake
- `AGUI_BASE_URL` / `AGUI_API_KEY` – Optional AG-UI endpoint and credentials
- `SESSION_STORE_DRIVER` – `memory` (default) or `redis`
- `REDIS_URL` – Required if `SESSION_STORE_DRIVER=redis`
- `WEBHOOK_RATE_LIMIT_MAX` / `WEBHOOK_RATE_LIMIT_WINDOW` – Optional webhook rate limiting overrides
- `MESSENGER_MAX_TEXT_LENGTH` – Maximum characters per outbound Messenger message (default 2000)
- `MESSENGER_TYPING_KEEP_ALIVE_MS` – Typing indicator keep-alive interval in milliseconds (default 5000)

### Running the Gateway

```bash
pnpm tsx --env-file=.env apps/messenger-webhook/src/index.ts
```

The server listens on `PORT` (default 8080) and exposes:

- `GET /webhook` – Facebook webhook verification
- `POST /webhook` – Messenger event intake
- `GET /healthz` – Health probe for infra checks
- `GET /metrics` – Prometheus metrics

### Tests & Linting

```bash
pnpm test      # Vitest suite
pnpm lint      # ESLint
pnpm format    # Prettier check
```

CI runs lint, type-check, and tests on every push via [GitHub Actions](https://github.com/contextablemark/facebook-messenger-agui-client/actions/workflows/ci.yml).

## Deployment Notes

The `infra/railway` directory contains deployment manifests for Railway. Ensure the environment variables from `.env.example` are configured in the target environment before promoting builds.

## Future Enhancements

- Richer AG-UI → Messenger translation once attachment/quick-reply schemas are published
- Integration tests for rate-limiting paths and AG-UI error handling
- Optional OpenTelemetry exporter alongside Prometheus metrics

## Contributing

When touching existing files, bring comments and documentation up to the standards defined in `AGENTS.md`. Use pnpm for all dependency and script management, and ensure CI passes before opening a pull request.

---

Questions or deployment issues? Open an issue here and consult the AG-UI protocol spec for integration details.
