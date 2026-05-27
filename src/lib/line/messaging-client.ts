/**
 * LINE Messaging API client — singleton via @line/bot-sdk.
 *
 * Server-only. The channel access token must NEVER reach the client
 * bundle. Importing this file from a Client Component would crash at
 * build time because the env var is server-only.
 *
 * The bot-sdk's `messagingApi.MessagingApiClient` handles auth headers,
 * retry on transient errors, and idempotency keys. We use it for:
 *   - pushMessage (single user)
 *   - multicastMessage (up to 500 users in one call — useful when we
 *     have multiple recipients of the same event, e.g. branch-wide
 *     announcements; not used in Phase 1)
 */

import { messagingApi } from '@line/bot-sdk';

let client: messagingApi.MessagingApiClient | null = null;

export function getLineMessagingClient(): messagingApi.MessagingApiClient {
  if (client) return client;
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not set — required for push notifications',
    );
  }
  client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
  return client;
}
