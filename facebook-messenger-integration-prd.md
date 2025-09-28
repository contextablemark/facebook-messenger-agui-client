# Facebook Messenger Integration PRD

## Overview

The Facebook Messenger integration enables AnySphere Graph to receive, process, and respond to messages from business-managed Messenger channels. The feature will expose a webhook endpoint that validates Facebook signatures, translate incoming payloads into the platform's unified message schema, and route outbound replies through Facebook's Send API. The integration must offer a fast developer onboarding experience with clear deployment paths for both local experimentation and production.

## Goals

- Provide a reliable bridge between Facebook Messenger conversations and the AnySphere Graph messaging infrastructure.
- Ship a developer experience that works locally via Docker Compose and scales via a managed Railway deployment.
- Document all configuration, deployment, and operational steps so support and solutions engineers can follow a repeatable playbook.

## Non-Goals

- Building a full Messenger bot authoring interface.
- Supporting legacy Facebook apps that do not meet current Graph API requirements.
- Delivering multi-tenant billing or quota enforcement beyond existing platform capabilities.

## Success Metrics

- 95% of Messenger webhook events are processed within 2 seconds end-to-end.
- Messenger-to-platform message delivery errors remain below 0.5% weekly.
- Internal developer onboarding survey yields 4.5+/5 satisfaction with documentation and deployment experience.

## Repository Scaffold

```
.
├── apps
│   └── messenger-webhook
├── infra
│   └── railway
│       ├── README.md
│       └── railway.json
├── packages
│   ├── messaging-sdk
│   └── server-utils
├── docker-compose.yml
└── docs
    ├── implementation-plan.md
    └── drafts
        └── facebook-messenger-integration-prd.md
```

- `infra/railway/` holds managed deployment manifests and instructions for the shared Railway project.
- `docker-compose.yml` continues to provide the recommended local development and QA environment.
- All Messenger integration source code lives under `apps/messenger-webhook` with shared utilities in `packages/`.
- `docs/implementation-plan.md` captures the detailed execution roadmap and status tracking for the project.

## Documentation

1. Update the repository `README.md` to deliver a guided quickstart covering:
   - pnpm workspace bootstrapping, lint/type-check/test commands, and parity between Docker Compose and the Railway build pipeline.
   - Installing the Railway CLI (`npm i -g railway`), logging in with `railway login`, and linking to the shared project via `railway link`.
   - Running local services with `docker compose up messenger-webhook` (or a dedicated profile) alongside ngrok configuration for webhook verification.
   - Environment variable reference table mapping Facebook, AG-UI, and Railway secrets, plus troubleshooting callouts for signature mismatches and Send API errors.
2. Add an `infra/railway/README.md` with:
   - Environment variable mappings between Railway, Facebook App settings, and the webhook application.
   - Steps for provisioning services using `railway up` from `infra/railway/railway.json`, including Postgres/Redis add-ons if required.
   - Guidance for viewing logs via `railway logs messenger-webhook`, promoting builds with `railway deploy --service messenger-webhook --from build`, and rolling back using `railway deployments`.
   - Token rotation procedures, audit recommendations, and escalation paths for on-call engineers.
3. Produce companion documents under `docs/`:
   - `docs/SETUP.md` for Facebook developer console onboarding with screenshots, webhook verification, and signature debugging.
   - `docs/DEPLOYMENT.md` for Docker Compose ↔ Railway parity, CLI workflows, scaling playbooks, and observability setup.
   - `docs/RUNBOOK.md` outlining incident response, rate-limit management, and secrets rotation checklists.
   - `docs/BLOG_OUTLINE.md` drafting the launch narrative tying local development to Railway-managed operations.

## Deployment Targets

- **Local / Developer:** Docker Compose orchestrates the webhook app and supporting services (e.g., Postgres, Redis). Developers use `docker compose --profile messenger up` with tunnelled Facebook callbacks via ngrok for webhook verification.
- **Staging and Production:** Railway hosts the containerized webhook service. Deployment artifacts come from `infra/railway/railway.json` and environment configuration lives in Railway secrets. CI promotes builds by running `railway deploy --service messenger-webhook --from build`. Blue/green deploys leverage Railway's automatic service versioning.
- **Observability:** Logs and metrics flow through Railway's dashboard with forwarders to Grafana. Alerts are configured using Railway's integrations for Slack and PagerDuty.

## Implementation Plan

### Phase & Milestone Schedule

| Phase                                      | Target Duration | Key Outcomes                                                                                                                          |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 – Repository Foundation**             | Week 1          | pnpm workspace, shared lint/test config, baseline CI smoke job, directory skeleton (`apps/`, `packages/`, `infra/railway/`, `docs/`). |
| **P1 – Messenger Agent SDK**               | Weeks 2-3       | `FacebookMessengerAgent`, payload normalization utilities, signature helpers, unit tests, Typedoc build artifact.                     |
| **P2 – Gateway Service**                   | Weeks 3-5       | Fastify webhook endpoints, session store abstraction, AG-UI event translation, slash command support, structured logging and metrics. |
| **P3 – Configuration & Docs**              | Weeks 5-6       | `.env.example`, README quickstart, setup/deployment/troubleshooting guides, security checklist draft.                                 |
| **P4 – Railway Deployment & CI Hardening** | Weeks 6-7       | Dockerfile/compose parity, `infra/railway/railway.json`, Railway CLI workflow, deploy GitHub Action, release automation hooks.        |
| **P5 – Final QA & Launch Prep**            | Week 8          | Local + Railway staging smoke tests, runbooks, observability validation, launch communications package.                               |

### Detailed Workstreams

1. **Repository Initialization**
   - Scaffold pnpm workspace (`package.json`, `pnpm-workspace.yaml`) covering `apps/messenger-webhook`, `packages/messaging-sdk`, and shared tooling.
   - Establish shared TypeScript configs, ESLint/Prettier rules, Husky pre-commit hooks, and Changesets configuration for eventual package releases.
   - Author base GitHub Action (`.github/workflows/ci.yml`) that runs lint, type-check, and tests on Node 18/20 with caching and coverage upload.
2. **Messenger Agent Package (`packages/messaging-sdk`)**
   - Implement `FacebookMessengerAgent` extending AG-UI HTTP abstractions with helpers for text, attachments, and quick reply normalization.
   - Provide signature verification utilities and thread/session metadata mappers to share across services.
   - Achieve near-100% unit test coverage for payload transforms, signature validation, and error handling.
   - Generate API docs via Typedoc (output to `docs/reference/` or package README) and wire Changesets for semantic versioning.
3. **Messenger Gateway Service (`apps/messenger-webhook`)**
   - Build Fastify server exposing `GET /webhook` verification, `POST /webhook` intake, and health probe endpoints.
   - Integrate middleware for signature validation, request tracing, rate limiting, and correlation IDs.
   - Translate AG-UI run events into Messenger actions (typing indicators, message sends, error fallbacks) and implement slash commands (`/reset`, `/help`).
   - Introduce session store abstraction with in-memory default and Redis adapter; document scaling considerations for Railway.
   - Add observability instrumentation (pino logs, Prometheus metrics exporter) and retries/backoff for Send API failures.
4. **Configuration & Security**
   - Create `.env.example` detailing Facebook credentials, AG-UI endpoints, session store settings, Railway project/service IDs, and optional Redis URL.
   - Document secret management practices, TLS expectations, webhook signature validation, and rate-limit monitoring in `docs/SETUP.md` and runbooks.
   - Build configuration drift detection (script comparing `.env` vs. Railway secrets) and integrate into CI warnings.
5. **Tooling, CI/CD, and Release Automation**
   - Extend CI with job stages for lint/typecheck/unit tests, Docker image build, and artifact caching for Railway deploys.
   - Author `railway-deploy.yml` workflow to authenticate with `RAILWAY_TOKEN`, run build commands, and execute `railway deploy --service messenger-webhook --from build` for staging/production environments.
   - Provide developer scripts (`scripts/dev.sh`, `scripts/verify.mjs`) that orchestrate local dev, ngrok tunneling, and verification steps aligning with CI gating.
6. **Testing & Verification**
   - Unit tests for payload normalization, signature verification, session adapters, and slash command handlers.
   - Integration tests using mocked Messenger payloads and AG-UI responses (MSW/nock) validating retries, typing indicators, and error flows.
   - End-to-end smoke harness that exercises Docker Compose locally and Railway staging deployments, capturing latency and delivery metrics.
   - Performance regression suite ensuring <2s median processing and <0.5% delivery errors; report findings in launch readout.
7. **Deployment & Operations**
   - Author `infra/railway/railway.json` describing service definition, build/deploy settings, health checks, and add-ons (Redis/Postgres as needed).
   - Document Railway secrets management, log access, rollback, and autoscaling toggles in `infra/railway/README.md`.
   - Maintain Docker Compose parity with the Railway service and note fallback procedures if Railway is unavailable.
   - Define observability integration (Grafana dashboards, alert routes) and link metrics names to on-call expectations.
8. **Risk Management & Success Tracking**
   - Track risks such as Railway plan limits, CLI token expiration, webhook downtime, and secret drift with clear owners and mitigations.
   - Monitor success metrics (webhook latency, delivery errors, onboarding satisfaction) and log progress in `docs/implementation-plan.md` during weekly reviews.
   - Capture open questions (package publishing strategy, localization, attachment roadmap) and resolve them during backlog grooming.

## Risks & Mitigations

- **Railway resource limits or plan changes** may impact uptime. Mitigation: configure horizontal autoscaling in `railway.json`, monitor usage, and maintain exportable Terraform-equivalent config for migration fallback.
- **CLI authentication churn** could block deploys. Mitigation: rotate Railway tokens regularly, document `railway status` checks in runbooks, and add automated reminders for token renewal.
- **Webhook downtime during deploys** risks Facebook verification failures. Mitigation: rely on Railway's zero-downtime deploy strategy, keep `docker compose` environment ready for emergency failover, and document manual rollback via `railway rollback`.
- **Secrets drift between local and cloud** could introduce inconsistent behavior. Mitigation: manage secrets centrally in Railway, mirror them locally via `.env` templates, and run configuration drift checks in CI.

## Blog Outline

1. **Hook:** Highlight how the team moved from manual Messenger integrations to a standardized deployment via Docker Compose locally and Railway in the cloud.
2. **Problem Statement:** Challenges maintaining webhook infrastructure and aligning local testing with production environments.
3. **Solution Overview:** Describe the new Messenger integration, the Docker Compose developer workflow, and Railway-managed production pipeline.
4. **Technical Deep Dive:**
   - Webhook validation, message translation, and outbound messaging.
   - Infrastructure as code using `infra/railway/railway.json` and CI-driven `railway deploy` commands.
   - Observability and rollback using Railway dashboards.
5. **Results:** Faster onboarding, reduced deploy friction, and improved reliability metrics.
6. **Call to Action:** Encourage developers to try the integration and follow the Railway deployment guide for their own Messenger use cases.
