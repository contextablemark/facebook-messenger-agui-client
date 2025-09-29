# Messenger Webhook Troubleshooting

Use this runbook to diagnose common issues when developing or operating the Messenger webhook gateway.

## 1. Service will not start

- **Missing environment variables** – The config loader throws a descriptive error (e.g., `FB_APP_SECRET is required`). Confirm `.env` or the Railway environment contains all required keys listed in `.env.example` and `infra/railway/README.md`.
- **PORT conflicts** – If the gateway logs `EADDRINUSE`, set `PORT` to an available value in `.env` or the hosting environment.
- **Redis connection failures** – When running with `SESSION_STORE_DRIVER=redis`, make sure `REDIS_URL` points to a reachable instance. Look for `ECONNREFUSED` or authentication errors in the logs and verify credentials with `redis-cli`.

## 2. Webhook verification fails

- If Facebook reports `403` during the `GET /webhook` handshake, double-check `FB_WEBHOOK_VERIFY_TOKEN`. The gateway compares it verbatim with the `hub.verify_token` query parameter.
- Ensure your tunnelling tool (ngrok, Cloudflare Tunnel, etc.) forwards query parameters intact. Some proxies strip them by default.

## 3. Signature mismatches on POST /webhook

- Confirm that Facebook requests contain the `x-hub-signature-256` header. If you replay payloads manually, compute the signature with the same app secret used in `.env`.
- Review the Fastify logs. When the signature guard rejects a request it logs `invalid signature` at `warn` level with the request id.
- Keep the server clock accurate. Significant clock drift can manifest as signature errors if the payload is stale and the Facebook platform retries with the same signature.

## 4. Messenger responses not delivered

- Inspect the gateway logs for Send API responses. The `MessengerWebhookService` logs non-200 responses with the Facebook error payload.
- Verify `FB_PAGE_ACCESS_TOKEN` is valid for the page subscribed to the webhook. Regenerate the token from the Facebook App dashboard if the page was reconnected.
- Ensure the AG-UI dispatcher returns a message payload. When AG-UI responds with `204 No Content`, the gateway intentionally skips outbound Messenger messages.

## 5. AG-UI calls failing

- 401/403 responses indicate an invalid `AGUI_API_KEY` or the target endpoint rejecting the request. Regenerate the key and confirm the base URL is correct.
- Timeouts usually point to networking issues between Railway and the AG-UI host. Check Railway's networking status and any configured outbound allowlists.

## 6. Rate limiting or throughput concerns

- Use `WEBHOOK_RATE_LIMIT_MAX` and `WEBHOOK_RATE_LIMIT_WINDOW` to adjust the Fastify rate-limit plugin. Document any overrides in `infra/railway/README.md`.
- Monitor the Prometheus metrics exported at `/metrics` (`messenger_webhook_requests_total`, `messenger_webhook_failures_total`, etc.) to spot spikes.

## 7. Observability checklist

- Enable structured logging ingestion (e.g., Railway Logs, Datadog) to capture the JSON logs produced by Pino.
- Scrape `/metrics` with Prometheus and alert on sustained error rates or timeouts.
- Add synthetic monitors for `GET /healthz` to detect outages before Messenger retries exhaust.

## Need more help?

- Cross-reference the implementation plan (`docs/implementation-plan.md`) for ownership details.
- Escalate to the AG-UI platform team when encountering protocol-level issues documented in the DeepWiki repo (`ag-ui-protocol/ag-ui`).
