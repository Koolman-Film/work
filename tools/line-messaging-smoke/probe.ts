/**
 * LINE Messaging API smoke test — verifies the bot's channel access
 * token works.
 *
 * Run:
 *   pnpm tsx --env-file=.env.local tools/line-messaging-smoke/probe.ts
 *
 * Steps:
 *   1. GET /v2/bot/info — returns the bot's display name, user-id,
 *      premium status. Auth fail = invalid/expired token.
 *   2. GET /v2/bot/info/quota — returns the free-tier monthly limit
 *      (200 messages/mo for unverified bots; unlimited if verified).
 *      Useful to confirm we know what plan we're on.
 *   3. (Skip) Test push to a real user requires their LINE userId, which
 *      we only get after they friend the bot. The probe stops at "auth
 *      works." Pushing a real Flex Message is the next-level test that
 *      happens during W4-late/B integration test.
 *
 * No push is sent during this probe — purely a read-only auth check.
 */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg: string): never {
  console.error(`${RED}✗${RESET} ${msg}`);
  process.exit(1);
}
function step(msg: string) {
  console.log(`${DIM}→${RESET} ${msg}`);
}

async function main() {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  const channelId = process.env.LINE_MESSAGING_CHANNEL_ID;
  if (!token) {
    fail('Missing LINE_MESSAGING_CHANNEL_ACCESS_TOKEN in env');
  }
  if (!channelId) {
    fail('Missing LINE_MESSAGING_CHANNEL_ID in env');
  }

  console.log(`\n${DIM}Probing LINE Messaging API (channel ${channelId})${RESET}\n`);

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  } as const;

  // ── 1. /v2/bot/info — auth + identity check ───────────────────────────
  step('GET /v2/bot/info');
  const infoRes = await fetch('https://api.line.me/v2/bot/info', { headers });
  if (!infoRes.ok) {
    const body = await infoRes.text();
    fail(
      `bot/info returned HTTP ${infoRes.status} — token is likely invalid or expired.\n` +
        `  Body: ${body.slice(0, 200)}`,
    );
  }
  const info = (await infoRes.json()) as {
    userId: string;
    basicId: string;
    displayName: string;
    pictureUrl?: string;
    premiumId?: string;
    chatMode: string;
    markAsReadMode: string;
  };
  ok(`bot identity confirmed`);
  console.log(`   ${DIM}displayName:${RESET}  ${info.displayName}`);
  console.log(`   ${DIM}basicId:${RESET}      ${info.basicId}`);
  console.log(`   ${DIM}userId:${RESET}       ${info.userId}`);
  console.log(`   ${DIM}chatMode:${RESET}     ${info.chatMode}`);
  console.log(`   ${DIM}markAsRead:${RESET}   ${info.markAsReadMode}`);
  if (info.chatMode === 'bot') {
    ok(`chatMode='bot' — push will work (chat replies disabled, as configured)`);
  } else {
    console.warn(
      `${RED}!${RESET} chatMode='${info.chatMode}' — push works regardless, but you may want bot-mode`,
    );
  }

  // ── 2. /v2/bot/message/quota — push quota for this billing period ────
  step('GET /v2/bot/message/quota');
  const quotaRes = await fetch('https://api.line.me/v2/bot/message/quota', { headers });
  if (!quotaRes.ok) {
    const body = await quotaRes.text();
    fail(`quota returned HTTP ${quotaRes.status}\n  Body: ${body.slice(0, 200)}`);
  }
  const quota = (await quotaRes.json()) as {
    type: 'none' | 'limited';
    value?: number;
  };
  if (quota.type === 'none') {
    ok(`message quota: unlimited (verified bot)`);
  } else {
    ok(`message quota: ${quota.value ?? '?'} messages / month (free tier)`);
    if (quota.value && quota.value < 1000) {
      console.warn(
        `${RED}!${RESET} Tight quota. Each leave/advance approval pushes 1 message.\n` +
          `  At 20 employees × ~10 approvals/month = 200 pushes/month minimum.\n` +
          `  Consider applying for LINE OA verification to lift the cap.`,
      );
    }
  }

  // ── 3. /v2/bot/message/quota/consumption — already-used count ────────
  step('GET /v2/bot/message/quota/consumption');
  const consumedRes = await fetch('https://api.line.me/v2/bot/message/quota/consumption', {
    headers,
  });
  if (!consumedRes.ok) {
    fail(`consumption returned HTTP ${consumedRes.status}`);
  }
  const consumed = (await consumedRes.json()) as { totalUsage: number };
  ok(`messages sent this period: ${consumed.totalUsage}`);

  console.log(
    `\n${GREEN}All checks passed.${RESET} LINE Messaging API is ready for push.\n`,
  );
  console.log(
    `${DIM}Next: build Track B/C — wire @line/bot-sdk + Inngest for actual leave/advance push notifications.${RESET}\n`,
  );
}

main().catch((err) => {
  console.error(`${RED}Probe crashed:${RESET}`, err);
  process.exit(1);
});
