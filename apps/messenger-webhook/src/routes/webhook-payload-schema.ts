import type { MessengerWebhookPayload } from '@agui/messaging-sdk';
import { z } from 'zod';

/**
 * Zod schema describing the subset of the Facebook Messenger webhook payload
 * we rely on. Unknown properties are preserved to avoid losing metadata but
 * structural validation guards against malformed requests and unexpected
 * shapes from the Graph API. The schema allows Messenger to add optional
 * fields without breaking validation while ensuring the contract stays sane.
 */
const messengerWebhookPayloadSchema = z
  .object({
    object: z.literal('page'),
    entry: z
      .array(
        z
          .object({
            id: z.string().min(1),
            time: z.number().int().nonnegative(),
            messaging: z
              .array(
                z
                  .object({
                    sender: z.object({ id: z.string().min(1) }),
                    recipient: z.object({ id: z.string().min(1) }),
                    timestamp: z.number().int().nonnegative(),
                    message: z.any().optional(),
                    postback: z.any().optional(),
                  })
                  .passthrough(),
              )
              .min(1),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

/**
 * Validate the inbound webhook body and return a strongly typed payload. Any
 * validation failure is surfaced to the caller so route handlers can translate
 * it into an HTTP 400 response before touching downstream services.
 */
export function parseMessengerWebhookPayload(payload: unknown): MessengerWebhookPayload {
  return messengerWebhookPayloadSchema.parse(payload) as MessengerWebhookPayload;
}
