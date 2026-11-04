import { type Inline, parseBody } from '@/lib/product-updates/rich-text';
import { cn } from '@/lib/utils';

/**
 * Renders a summary's token tree (rich-text.ts). Builds React elements from
 * tokens — the parser never emits HTML, so there is no injection path from
 * registry copy.
 *
 * Index keys throughout: blocks and spans are positional, derived fresh from
 * immutable copy on every render, and can never reorder or be inserted into.
 * That is the exact case the key warning does not apply to.
 */
export function RichBody({ source, className }: { source: string; className?: string }) {
  const blocks = parseBody(source);

  return (
    <div className={cn('space-y-1.5 leading-relaxed text-ink-2', className)}>
      {blocks.map((block, i) =>
        block.kind === 'list' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <ul className="space-y-1" key={i}>
            {block.items.map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
              <li className={BULLET} key={j}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <p key={i}>
            <Spans spans={block.spans} />
          </p>
        ),
      )}
    </div>
  );
}

// The marker is a ::before dot rather than list-style, so a wrapped bullet's
// second line aligns under the text instead of under the dot. Thai wraps often
// at dialog width, which makes that difference very visible.
const BULLET =
  'relative pl-4 before:absolute before:left-1 before:top-[0.55em] before:size-1 before:rounded-full before:bg-ink-4';

// Not <mark>: the UA default is a yellow that fights both themes and fails
// contrast in dark. A brand-tinted chip carries the same "do not miss this"
// weight and is theme-aware by construction.
const MARK = 'rounded bg-primary-50 px-1 font-medium text-primary-800';

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.bold ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <strong className="font-semibold text-ink-1" key={i}>
            {span.text}
          </strong>
        ) : span.italic ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <em key={i}>{span.text}</em>
        ) : span.mark ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <span className={MARK} key={i}>
            {span.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  );
}
