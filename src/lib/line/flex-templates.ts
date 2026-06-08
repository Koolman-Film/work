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
 * Why we hardcode template strings instead of i18n:
 *   v1 is Thai-only by product decision. Adding i18n now would be
 *   yak-shaving for an audience of one language.
 */

import type { messagingApi } from '@line/bot-sdk';
import type { NotificationPayload } from '@/lib/inngest/events';

type FlexMessage = messagingApi.FlexMessage;
type FlexBubble = messagingApi.FlexBubble;
type FlexBox = messagingApi.FlexBox;
type FlexBoxComponent = NonNullable<FlexBox['contents']>[number];

const PRIMARY = '#2563eb';
const GREEN = '#16a34a';
const RED = '#dc2626';
const TEXT_DARK = '#1f2937';
const TEXT_MUTED = '#6b7280';

/**
 * Format a YYYY-MM-DD string in Thai short-date form (e.g. "12 พ.ค. 2569"
 * including Buddhist-era year).
 */
function fmtThaiDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  // Use UTC formatter because the input is a UTC midnight calendar day.
  const formatter = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return formatter.format(d);
}

function fmtDateRange(startYmd: string, endYmd: string): string {
  return startYmd === endYmd
    ? fmtThaiDate(startYmd)
    : `${fmtThaiDate(startYmd)} – ${fmtThaiDate(endYmd)}`;
}

/** Build a Flex Message bubble for the given notification payload. */
export function buildFlexMessage(payload: NotificationPayload, appBaseUrl: string): FlexMessage {
  let bubble: FlexBubble;
  let altText: string;

  switch (payload.kind) {
    case 'leave.approved':
      altText = `✅ คำขอลา ${payload.leaveTypeName} ของคุณได้รับการอนุมัติ`;
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: 'อนุมัติคำขอลา',
        title: `${payload.leaveTypeName}`,
        subtitle: fmtDateRange(payload.startDate, payload.endDate),
        details: [
          payload.durationLabel
            ? { label: 'ระยะเวลา', value: payload.durationLabel }
            : payload.workingDays != null
              ? { label: 'วันทำงาน', value: `${payload.workingDays} วัน` }
              : null,
          payload.reviewNote ? { label: 'หมายเหตุ', value: payload.reviewNote } : null,
        ],
        actionLabel: 'ดูรายละเอียด',
        actionUri: `${appBaseUrl}/liff/leave/${payload.leaveRequestId}`,
      });
      break;

    case 'leave.rejected':
      altText = `❌ คำขอลา ${payload.leaveTypeName} ของคุณถูกปฏิเสธ`;
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: 'ไม่อนุมัติคำขอลา',
        title: `${payload.leaveTypeName}`,
        subtitle: fmtDateRange(payload.startDate, payload.endDate),
        details: [payload.reviewNote ? { label: 'เหตุผล', value: payload.reviewNote } : null],
        actionLabel: 'ดูรายละเอียด',
        actionUri: `${appBaseUrl}/liff/leave/${payload.leaveRequestId}`,
      });
      break;

    case 'advance.approved':
      altText = `✅ คำขอเบิก ฿${payload.amount} ของคุณได้รับการอนุมัติ`;
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: 'อนุมัติคำขอเบิก',
        title: `฿${payload.amount}`,
        subtitle: 'จะหักจากเงินเดือนงวดถัดไป',
        details: [],
        actionLabel: 'ดูรายละเอียด',
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'advance.rejected':
      altText = `❌ คำขอเบิก ฿${payload.amount} ของคุณถูกปฏิเสธ`;
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: 'ไม่อนุมัติคำขอเบิก',
        title: `฿${payload.amount}`,
        subtitle: 'กรุณาติดต่อแอดมินเพื่อขอข้อมูลเพิ่มเติม',
        details: [],
        actionLabel: 'ดูรายละเอียด',
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'attendance.dispute-approved':
      altText = `✅ เช็คอินวันที่ ${fmtThaiDate(payload.date)} ของคุณได้รับการยืนยัน`;
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: 'ยืนยันการเช็คอิน',
        title: fmtThaiDate(payload.date),
        subtitle: 'แอดมินตรวจสอบและยืนยันการเช็คอินที่ต้องตรวจสอบแล้ว',
        details: [payload.reviewNote ? { label: 'หมายเหตุ', value: payload.reviewNote } : null],
        actionLabel: 'ดูประวัติเช็คอิน',
        actionUri: `${appBaseUrl}/liff/check-in`,
      });
      break;

    case 'attendance.dispute-rejected':
      altText = `❌ เช็คอินวันที่ ${fmtThaiDate(payload.date)} ของคุณถูกปฏิเสธ`;
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: 'ปฏิเสธการเช็คอิน',
        title: fmtThaiDate(payload.date),
        subtitle: 'แอดมินไม่ยืนยันการเช็คอินวันดังกล่าว',
        details: [payload.reviewNote ? { label: 'เหตุผล', value: payload.reviewNote } : null],
        actionLabel: 'ดูประวัติเช็คอิน',
        actionUri: `${appBaseUrl}/liff/check-in`,
      });
      break;
  }

  return {
    type: 'flex',
    altText,
    contents: bubble,
  };
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
