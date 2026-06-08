/**
 * Inngest webhook handler — `/api/inngest`.
 *
 * Inngest's serverless integration: this single route exposes:
 *   - GET — used by Inngest to discover the functions this app serves
 *           (returns function metadata + signature for the dashboard)
 *   - POST — used by Inngest to invoke a function (with HMAC-signed
 *            payload; serve() verifies the signature using
 *            INNGEST_SIGNING_KEY)
 *   - PUT — used by `inngest-cli dev` for local dev-server discovery
 *
 * Auth: signature verification happens inside `serve()`. If the
 * signing key doesn't match, the request 401s before our function
 * code runs. The signing key is environment-tagged (signkey-prod-,
 * signkey-test-) — make sure the right key is set per env or all
 * function invocations will fail opaquely.
 *
 * Functions: add new functions to the `functions` array as we build
 * them (e.g. attendance-late-check, force-checkout-eod crons).
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { attendanceForceCheckoutEod } from '@/lib/inngest/functions/attendance-force-checkout-eod';
import { attendanceLateCheck } from '@/lib/inngest/functions/attendance-late-check';
import { birthdayReminder } from '@/lib/inngest/functions/birthday-reminder';
import { linePushNotification } from '@/lib/inngest/functions/line-push';
import { probationReminder } from '@/lib/inngest/functions/probation-reminder';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    linePushNotification,
    attendanceForceCheckoutEod,
    attendanceLateCheck,
    probationReminder,
    birthdayReminder,
  ],
});
