# Security Checklist

Use this checklist during reviews and before promoting the Messenger webhook gateway to production. Capture the outcomes in your deployment runbook for auditability.

## Secrets & credentials

- [ ] Store all Facebook and AG-UI tokens in a managed secrets store (Railway environment variables), never in Git.
- [ ] Rotate `FB_APP_SECRET` and `FB_PAGE_ACCESS_TOKEN` at least quarterly or after any suspected compromise.
- [ ] Enforce least privilege on AG-UI credentials—scoped API keys that can only trigger the required run workflows.
- [ ] Audit Redis credentials and ensure TLS is enabled when offered by the provider.

## Transport & network

- [ ] Terminate TLS at the edge (Railway-provided certificate or custom domain) before traffic reaches Fastify.
- [ ] Restrict the Messenger webhook endpoint to Facebook IP ranges using Railway firewall rules when available.
- [ ] Keep system clocks in sync (Railway handles this automatically) to avoid HMAC replay windows.

## Application hardening

- [ ] Confirm Helmet middleware remains enabled with the default policy set (`@fastify/helmet`).
- [ ] Validate rate limiting (`@fastify/rate-limit`) is configured with thresholds appropriate for your Messenger volume.
- [ ] Scan dependencies for known vulnerabilities (`pnpm audit --prod`) before each release.
- [ ] Ensure Fastify logs do not emit sensitive payload contents—debug logging should stay disabled in production.

## Data handling & privacy

- [ ] Document the retention policy for Messenger conversation transcripts stored in Redis or downstream systems.
- [ ] Purge session keys (`messenger:*`) when conversations conclude to limit lingering PII.
- [ ] Avoid logging raw user messages unless required for debugging; mask PII where possible.

## Incident response

- [ ] Configure alerts on webhook failure rates and Redis connectivity metrics.
- [ ] Maintain on-call contact information and escalation paths in the operational runbook.
- [ ] Capture post-incident learnings and feed them back into this checklist.

Update this checklist as new platform requirements emerge or when the security team introduces revised guardrails.
