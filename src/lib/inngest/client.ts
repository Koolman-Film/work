/**
 * Inngest client — singleton.
 *
 * One client per process. The `id` becomes the Inngest "app" identifier
 * the dashboard groups functions under. Event keys + signing keys come
 * from env (set by `tools/inngest-smoke/probe.ts` smoke-tested config).
 *
 * NOTE on event typing: Inngest v4 removed the `EventSchemas`
 * compile-time typing helper from the top-level export. We get the
 * same effective type-safety by funneling all sends through wrapper
 * helpers in `./events.ts` (e.g. `sendNotification(...)`) — callers
 * can't construct a malformed event because they can't reach
 * `inngest.send` directly. The cost is no auto-complete on `name`
 * strings inside `inngest.send`; the benefit is no SDK version
 * coupling to internal type machinery that changes between releases.
 */

import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'koolman-hr' });

export type KoolmanInngest = typeof inngest;
