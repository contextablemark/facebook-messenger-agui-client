# Facebook Messenger Integration Implementation Plan

## Purpose

This document expands the Facebook Messenger integration PRD into an actionable plan that guides delivery from repository scaffolding through production launch on Railway. It is meant to be a living artifact that captures milestones, owners, and open questions as work progresses.

## Guiding Objectives

- Deliver a dependable webhook bridge that maps Messenger conversations into AG-UI runs and responds through the Send API with sub-2s median latency.
- Provide an excellent developer experience that works locally via Docker Compose and promotes to Railway with repeatable CI/CD workflows.
- Maintain clear, version-controlled documentation and operational runbooks for internal stakeholders.

## Assumptions

- Railway is the managed hosting provider for staging and production; no Fly.io configuration is required.
- Docker Compose remains the canonical local environment and must stay in parity with the Railway deployment definition.
- The Messenger integration will share utilities with other messaging channels via a pnpm workspace.

## Phase & Milestone Schedule

| Phase                                      | Target Duration | Milestone Outcomes                                                                                                                                                                             |
| ------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 – Repository Foundation**             | Week 1          | pnpm workspace, shared lint/test config, baseline CI smoke job, directory skeleton (`apps/`, `packages/`, `infra/railway/`, `docs/`). **Status:** ✅ Baseline scaffolding merged (2025-09-28). |
| **P1 – Messenger Agent SDK**               | Weeks 2-3       | `FacebookMessengerAgent`, payload normalization utilities, signature helpers, unit tests, typedoc build. **Status:** ✅ Phase 1 delivered (2025-09-28).                                        |
| **P2 – Gateway Service**                   | Weeks 3-5       | Fastify webhook endpoints, session store abstraction, AG-UI event translation, slash command support, structured logging + metrics. **Status:** ✅ Completed (2025-09-29).                     |
| **P3 – Configuration & Docs**              | Weeks 5-6       | `.env.example`, README quickstart, setup/deployment/troubleshooting guides, security checklist draft. **Status:** ✅ Phase 3 documentation suite merged (2025-09-28).                          |
| **P4 – Railway Deployment & CI Hardening** | Weeks 6-7       | Dockerfile/compose parity, `infra/railway/railway.json`, Railway CLI workflow, deploy GitHub Action, release automation hooks.                                                                 |
| **P5 – Final QA & Launch Prep**            | Week 8          | Local + Railway staging smoke tests, runbooks, observability validation, launch communications package.                                                                                        |

## Detailed Workstreams

### 1. Repository Initialization

- Scaffold pnpm workspace (`package.json`, `pnpm-workspace.yaml`) covering `apps/messenger-webhook`, `packages/messaging-sdk`, and shared tooling.
- Establish shared TypeScript configs, ESLint/Prettier rules, Husky pre-commit hooks, and Changesets configuration for eventual package releases.
- Author base GitHub Action (`.github/workflows/ci.yml`) that runs lint, type-check, and tests on Node 18/20 with caching and coverage upload.

#### Phase 0 Execution Notes (2025-09-28)

- Created pnpm workspace scaffolding with repo-level `package.json`, `pnpm-workspace.yaml`, and baseline scripts for linting, testing, and formatting.
- Added shared tooling configuration: `tsconfig.base.json`, `tsconfig.build.json`, ESLint, Prettier, Vitest, and Husky with lint-staged integration.
- Established directory skeleton for `apps/messenger-webhook`, `packages/messaging-sdk`, `infra/railway/`, and `scripts/`, including placeholder READMEs for the app and SDK packages.
- Authored CI workflow (`.github/workflows/ci.yml`) covering lint, type-check, and test jobs on Node 18.x and 20.x using pnpm caching.

### 2. Messenger Agent Package (`packages/messaging-sdk`)

- Implement `FacebookMessengerAgent` extending AG-UI HTTP abstractions with helpers for text, attachments, and quick reply normalization.
- Provide signature verification utilities and thread/session metadata mappers to share across services.
- Achieve near-100% unit test coverage for payload transforms, signature validation, and error handling.
- Generate API docs via Typedoc (output to `docs/reference/` or README) and wire Changesets for semantic versioning.

#### Phase 1 Execution Notes (2025-09-28)

- Delivered `FacebookMessengerAgent` with outbound Send API orchestration, signature verification, webhook normalization entry points, and rich error propagation.
- Factored reusable utilities (`normalizeWebhookPayload`, message/quick reply builders, signature helpers) exposed through the messaging SDK for downstream services.
- Added comprehensive unit tests covering agent behaviours, normalization branches, and signature validation edge cases to lock in regression protection.
- Wired Typedoc generation via `pnpm docs:messaging-sdk`, publishing static docs under `docs/reference/messaging-sdk` for consumer reference.

### 3. Messenger Gateway Service (`apps/messenger-webhook`)

- Build Fastify server exposing `GET /webhook` verification, `POST /webhook` intake, and health probe endpoints.
- Integrate middleware for signature validation, request tracing, rate limiting, and correlation IDs.
- Translate AG-UI run events into Messenger actions (typing indicators, message sends, error fallbacks) and implement slash commands (`/reset`, `/help`).
- Introduce session store abstraction with in-memory default and Redis adapter; document scaling considerations for Railway.
- Add observability instrumentation (pino logs, Prometheus metrics exporter) and retries/backoff for Send API failures.

**Future follow-ups:**

- Extend AG-UI response translation once richer payload schemas (attachments, quick replies) are available.
- Evaluate long-running typing indicator UX if Messenger clients restore reliable support.
- Add end-to-end integration coverage for rate limiting and AG-UI error surfaces once the deployment environment stabilises.

### 4. Configuration & Security

- Create `.env.example` detailing Facebook credentials, optional AG-UI endpoints, session store settings, and rate-limit tunables.
- Document secret management practices, TLS expectations, webhook signature validation, and rate-limit monitoring in `docs/security-checklist.md` and related runbooks.
- Build configuration drift detection (script comparing `.env` vs. Railway secrets) and integrate into CI warnings.

#### Phase 3 Execution Notes (2025-09-28)

- Shipped refreshed `.env.example` alongside local and hosted docs so developers and operators share the same baseline configuration checklist.
- Authored `docs/setup/local-development.md`, `docs/deployment/railway.md`, and `docs/troubleshooting/messenger-webhook.md` to cover quickstart, deployment, and incident response flows.
- Added a security checklist documenting secrets management, hardening expectations, and incident response guardrails to gate production launches.

### 5. Tooling, CI/CD, and Release Automation

- Extend CI with job stages for lint/typecheck/unit tests, Docker image build, and artifact caching for Railway deploys.
- Author `railway-deploy.yml` workflow to authenticate with `RAILWAY_TOKEN`, run build commands, and execute `railway deploy --service messenger-webhook --from build` for staging/production environments.
- Provide developer scripts (`scripts/dev.sh`, `scripts/verify.mjs`) that orchestrate local dev, ngrok tunneling, and verification steps aligning with CI gating.

### 6. Documentation Suite

- **README.md**: architecture overview, quickstart, environment variable table, testing commands, deployment summary, and troubleshooting highlights.
- **docs/setup/local-development.md**: Facebook Developer console setup notes, `.env` templating, Redis exercise, and local testing instructions.
- **docs/deployment/railway.md**: manual Railway workflow, CLI commands (`railway link`, `railway up`, `railway variables set`), and post-deploy validation.
- **docs/troubleshooting/messenger-webhook.md**: incident response for webhook downtime, Send API failures, Redis outages, secrets rotation, and alert thresholds.
- **docs/security-checklist.md**: security guardrails covering secrets, networking, observability, and incident response expectations.

### 7. Testing & QA Strategy

- Unit tests for payload normalization, signature verification, session adapters, and slash command handlers.
- Integration tests using mocked Messenger payloads and AG-UI responses (MSW/nock) validating retries, typing indicators, and error flows.
- End-to-end smoke harness that exercises Docker Compose locally and Railway staging deployments, capturing latency and delivery metrics.
- Performance regression suite ensuring <2s median processing and <0.5% delivery errors; report findings in launch readout.

### 8. Deployment & Operations

- Author `infra/railway/railway.json` describing service definition, build/deploy settings, health checks, and add-ons (Redis/Postgres as needed).
- Document Railway secrets management, log access, rollback, and autoscaling toggles in `infra/railway/README.md`.
- Maintain Docker Compose parity with the Railway service and note fallback procedures if Railway is unavailable.
- Define observability integration (Grafana dashboards, alert routes) and link metrics names to on-call expectations.

### 9. Risk Management & Success Criteria

- Track risks such as Railway plan limits, CLI token expiration, webhook downtime, and secret drift with clear owners and mitigations.
- Monitor success metrics (webhook latency, delivery errors, onboarding satisfaction) and log progress in this document during weekly reviews.
- Capture open questions (package publishing strategy, localization, attachment roadmap) and resolve them during backlog grooming.

## Status Tracking

| Workstream              | Owner      | Status        | Notes                                                                                                               |
| ----------------------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Repository foundation   |            | ✅ Done       | P0 scaffolding, tooling config, and CI workflow established.                                                        |
| Messenger agent SDK     | Codex (AI) | ✅ Done       | Phase 1 agent, signature verification, normalization helpers, and unit tests.                                       |
| Gateway service         |            | ✅ Done       | Webhook flow live with AG-UI dispatch, slash commands, metrics, and Messenger Send API integration.                 |
| Docs & configuration    | Codex (AI) | ✅ Done       | Phase 3 delivered `.env.example`, README quickstart, setup/deployment/troubleshooting docs, and security checklist. |
| CI/CD & Railway         |            | ☐ Not started |                                                                                                                     |
| Testing & QA            | Codex (AI) | In progress   | Messaging SDK unit tests landed; integration and end-to-end suites still pending.                                   |
| Deployment & operations |            | ☐ Not started |                                                                                                                     |

## Change Log

| Date       | Author     | Summary                                                                                    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------ |
| 2025-09-27 |            | Initial draft.                                                                             |
| 2025-09-28 |            | Phase 0 scaffolding: pnpm workspace, tooling baselines, CI workflow.                       |
| 2025-09-28 | Codex (AI) | Phase 1 delivers FacebookMessengerAgent, signature helpers, tests, and Typedoc script.     |
| 2025-09-28 | Codex (AI) | Phase 3 ships environment template, README quickstart, docs suite, and security checklist. |
