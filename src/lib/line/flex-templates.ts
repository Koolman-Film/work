/**
 * LINE Flex Message templates — one bubble per NotificationKind.
 *
 * Reference: https://developers.line.biz/en/reference/messaging-api/#flex-message
 *
 * Design choices that apply to all templates:
 *   - **Bubble size**: kilo (medium) — readable on phone notification
 *     preview without overflowing.
 *   - **Header color** signals decision: green = approved, red =
 *     rejected, amber = info/warning.
 *   - **Footer button** deep-links to the relevant LIFF page so the
 *     employee can drill in for details. Uses LIFF URLs (which open in
 *     the LINE in-app browser with the auth session intact).
 *   - **Plain-text altText** ALWAYS — populates the OS notification
 *     preview where Flex isn't supported (e.g. iOS lock screen).
 *
 * Templates are localized per recipient locale via `createTranslator` +
 * `getMessages(locale)` (chrome strings: headers, subtitles, labels, action
 * buttons, altText). Dynamic payload values such as `leaveTypeName` and
 * `reviewNote` are DB/free-text and pass through untranslated.
 */

import type { messagingApi } from '@line/bot-sdk';
import { createTranslator } from 'next-intl';
import type { Locale } from '@/lib/i18n/config';
import { formatDate, formatMoney } from '@/lib/i18n/format';
import { getMessages } from '@/lib/i18n/messages';
import type { NotificationPayload } from '@/lib/inngest/events';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import { formatDurationParts } from '@/lib/leave/units';

type FlexMessage = messagingApi.FlexMessage;
type FlexBubble = messagingApi.FlexBubble;
type FlexBox = messagingApi.FlexBox;
type FlexBoxComponent = NonNullable<FlexBox['contents']>[number];

const PRIMARY = '#2563eb';
const GREEN = '#16a34a';
const RED = '#dc2626';
const TEXT_DARK = '#1f2937';
const TEXT_MUTED = '#6b7280';

/** Parse a 'YYYY-MM-DD' calendar day into a Date (UTC midnight). */
function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function fmtDate(ymd: string, locale: Locale): string {
  const d = parseYmd(ymd);
  return Number.isNaN(d.getTime()) ? ymd : formatDate(d, locale);
}

function fmtDateRange(startYmd: string, endYmd: string, locale: Locale): string {
  return startYmd === endYmd
    ? fmtDate(startYmd, locale)
    : `${fmtDate(startYmd, locale)} – ${fmtDate(endYmd, locale)}`;
}

/** Build a Flex Message bubble for the given notification payload. */
export function buildFlexMessage(
  payload: NotificationPayload,
  appBaseUrl: string,
  locale: Locale,
): FlexMessage {
  // createTranslator's IntlMessages constraint is Record<string, any>; passing the
  // notifications sub-object directly (no namespace) keeps keys relative and avoids
  // the any cast on the full catalog. The value cast is safe — catalog is plain JSON.
  // biome-ignore lint/suspicious/noExplicitAny: use-intl IntlMessages requires any-valued records
  const notifMessages = getMessages(locale).notifications as Record<string, any>;
  const t = createTranslator({ locale, messages: notifMessages });
  // Separate translator for the shared `units` namespace ("{n} วัน" / "# days").
  // biome-ignore lint/suspicious/noExplicitAny: use-intl IntlMessages requires any-valued records
  const unitMessages = getMessages(locale).units as Record<string, any>;
  const tUnits = createTranslator({ locale, messages: unitMessages });
  let bubble: FlexBubble;
  let altText: string;

  switch (payload.kind) {
    case 'leave.approved': {
      const typeName = localizedLeaveTypeName(
        payload.leaveTypeName,
        payload.leaveTypeNameByLocale,
        locale,
      );
      const durationLabel = payload.duration
        ? formatDurationParts(payload.duration, {
            day: (n) => tUnits('day', { n }),
            hour: (n) => tUnits('hour', { n }),
            min: (n) => tUnits('min', { n }),
          })
        : null;
      altText = t('leaveApproved.alt', { type: typeName });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: t('leaveApproved.header'),
        title: typeName,
        subtitle: fmtDateRange(payload.startDate, payload.endDate, locale),
        details: [
          durationLabel
            ? { label: t('label.duration'), value: durationLabel }
            : payload.workingDays != null
              ? {
                  label: t('label.workingDays'),
                  value: t('workingDaysValue', { days: payload.workingDays }),
                }
              : null,
          payload.reviewNote ? { label: t('label.note'), value: payload.reviewNote } : null,
        ],
        notice:
          typeof payload.deductAmount === 'number' && payload.deductAmount > 0
            ? t('leaveApprovedDeduction', { amount: formatMoney(payload.deductAmount, locale) })
            : null,
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/leave/${payload.leaveRequestId}`,
      });
      break;
    }

    case 'leave.rejected': {
      const typeName = localizedLeaveTypeName(
        payload.leaveTypeName,
        payload.leaveTypeNameByLocale,
        locale,
      );
      altText = t('leaveRejected.alt', { type: typeName });
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: t('leaveRejected.header'),
        title: typeName,
        subtitle: fmtDateRange(payload.startDate, payload.endDate, locale),
        details: [
          payload.reviewNote ? { label: t('label.reason'), value: payload.reviewNote } : null,
        ],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/leave/${payload.leaveRequestId}`,
      });
      break;
    }

    case 'advance.approved':
      altText = t('advanceApproved.alt', { amount: payload.amount });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: t('advanceApproved.header'),
        title: `฿${payload.amount}`,
        subtitle: t('advanceApproved.subtitle'),
        details: [],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'advance.rejected':
      altText = t('advanceRejected.alt', { amount: payload.amount });
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: t('advanceRejected.header'),
        title: `฿${payload.amount}`,
        subtitle: t('advanceRejected.subtitle'),
        details: [],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'attendance.dispute-approved':
      altText = t('disputeApproved.alt', { date: fmtDate(payload.date, locale) });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: t('disputeApproved.header'),
        title: fmtDate(payload.date, locale),
        subtitle: t('disputeApproved.subtitle'),
        details: [
          payload.reviewNote ? { label: t('label.note'), value: payload.reviewNote } : null,
        ],
        actionLabel: t('action.viewAttendance'),
        actionUri: `${appBaseUrl}/liff/check-in`,
      });
      break;

    case 'attendance.dispute-rejected':
      altText = t('disputeRejected.alt', { date: fmtDate(payload.date, locale) });
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: t('disputeRejected.header'),
        title: fmtDate(payload.date, locale),
        subtitle: t('disputeRejected.subtitle'),
        details: [
          payload.reviewNote ? { label: t('label.reason'), value: payload.reviewNote } : null,
        ],
        actionLabel: t('action.viewAttendance'),
        actionUri: `${appBaseUrl}/liff/check-in`,
      });
      break;
  }

  return { type: 'flex', altText, contents: bubble };
}

/**
 * Shared bubble layout for all approved/rejected notifications. Single
 * builder keeps visual consistency — admins approve, employee sees a
 * uniform card every time regardless of which kind of request.
 */
function approvedRejectedBubble(args: {
  accent: string;
  headerEmoji: string;
  headerText: string;
  title: string;
  subtitle: string;
  details: ReadonlyArray<{ label: string; value: string } | null>;
  /** Optional one-line warning under the details (e.g. over-quota deduction). */
  notice?: string | null;
  actionLabel: string;
  actionUri: string;
}): FlexBubble {
  const detailRows = args.details
    .filter((d): d is { label: string; value: string } => d !== null)
    .map<FlexBoxComponent>((d) => ({
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        { type: 'text', text: d.label, size: 'sm', color: TEXT_MUTED, flex: 2 },
        { type: 'text', text: d.value, size: 'sm', color: TEXT_DARK, flex: 5, wrap: true },
      ],
    }));

  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: args.accent,
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: `${args.headerEmoji} ${args.headerText}`,
          color: '#ffffff',
          weight: 'bold',
          size: 'md',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: args.title,
          weight: 'bold',
          size: 'xl',
          color: TEXT_DARK,
          wrap: true,
        },
        {
          type: 'text',
          text: args.subtitle,
          size: 'sm',
          color: TEXT_MUTED,
          wrap: true,
        },
        ...(detailRows.length > 0
          ? [
              { type: 'separator' as const, margin: 'md' as const },
              {
                type: 'box' as const,
                layout: 'vertical' as const,
                spacing: 'sm' as const,
                margin: 'md' as const,
                contents: detailRows,
              },
            ]
          : []),
        ...(args.notice
          ? [
              {
                type: 'text' as const,
                text: args.notice,
                size: 'sm' as const,
                color: RED,
                wrap: true,
                margin: 'md' as const,
              },
            ]
          : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: PRIMARY,
          height: 'sm',
          action: {
            type: 'uri',
            label: args.actionLabel,
            uri: args.actionUri,
          },
        },
      ],
    },
  };
}

/** Used for the altText/action URLs. Falls back to localhost in dev. */
export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL ?? 'localhost:3000'}`;
}
