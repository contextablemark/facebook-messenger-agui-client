# Messaging SDK

The messaging SDK provides reusable helpers for working with Facebook Messenger payloads inside AG-UI services. Phase 1 introduces the `FacebookMessengerAgent`, signature utilities, and normalization helpers so other packages can trust consistent behaviour across webhook intake and outbound replies.

## Features

- `FacebookMessengerAgent` for verifying webhook signatures, normalising Messenger events, and sending replies through the Graph Send API.
- Pure utility functions to convert raw webhook payloads into typed, camel-cased structures that are easier to reason about.
- Strongly typed builders for text, attachment, and quick-reply messages, including guardrails for common validation mistakes.
- Low-level message builders (`buildTextMessagePayload`, etc.) for teams that need the raw Graph payloads.
- Typedoc configuration (`pnpm docs:messaging-sdk`) that produces reference documentation under `docs/reference/messaging-sdk`.

## Usage

```ts
import { FacebookMessengerAgent, normalizeWebhookPayload } from '@agui/messaging-sdk';

const agent = new FacebookMessengerAgent({
  appSecret: process.env.MESSENGER_APP_SECRET!,
  pageAccessToken: process.env.MESSENGER_PAGE_TOKEN!,
});

export function handleWebhook(body: unknown, signature: string | undefined) {
  const payload = body as Parameters<typeof normalizeWebhookPayload>[0];
  if (!agent.verifySignature(signature, JSON.stringify(payload))) {
    throw new Error('Invalid Messenger signature');
  }

  const events = agent.normalizeWebhook(payload);
  // Translate events into AG-UI actions here.
}

await agent.sendMessage({
  recipientId: 'RECIPIENT_ID',
  message: {
    kind: 'text',
    text: 'Hello from AG-UI!',
    quickReplies: [{ title: 'View dashboard' }],
  },
});
```

See `packages/messaging-sdk/src/agent.test.ts` for additional examples that cover error handling, quick replies, and sender actions.
