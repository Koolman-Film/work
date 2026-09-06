/**
 * The tiny markup a changelog body may use.
 *
 * Entries are localized plain strings — six of them per field — so the shape
 * has to survive being handed to a translator who is not a developer. A nested
 * `{ lead, points[] }` object would force every locale to agree on the number
 * of bullets; a line prefix does not, and a translator can add or merge a
 * bullet in their own language without touching a type.
 *
 * Deliberately NOT markdown-the-library: this parses four constructs, emits a
 * token tree (never HTML), and the renderer builds React elements from it. No
 * dependency, and no path by which registry copy could inject markup.
 *
 *   `- ` at line start   bullet; consecutive lines form one list
 *   `**bold**`           strong
 *   `_italic_`           emphasis
 *   `==highlight==`      marked run, for the one fact that must not be missed
 *
 * Delimiters do not nest, and an unmatched one is left as literal text — copy
 * that happens to contain an asterisk renders as written rather than eating
 * the rest of the paragraph.
 */

export type Inline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mark?: boolean;
};

export type Block = { kind: 'para'; spans: Inline[] } | { kind: 'list'; items: Inline[][] };

// Non-greedy alternation, scanned left to right. `_` is italic rather than a
// single `*` so that `**` can never be read as two nested emphases — Thai has
// no inter-word spaces, so a delimiter that relies on word boundaries is not
// available to us.
const INLINE = /\*\*(.+?)\*\*|_(.+?)_|==(.+?)==/g;

/** Split one line into styled runs. Never returns an empty array for a
 *  non-empty line; plain text yields a single unstyled span. */
export function parseInline(line: string): Inline[] {
  const spans: Inline[] = [];
  let last = 0;

  INLINE.lastIndex = 0;
  let m = INLINE.exec(line);
  while (m !== null) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], italic: true });
    else if (m[3] !== undefined) spans.push({ text: m[3], mark: true });
    last = m.index + m[0].length;
    m = INLINE.exec(line);
  }

  if (last < line.length) spans.push({ text: line.slice(last) });
  return spans;
}

/** Parse a body string into blocks. Blank lines separate; they emit nothing. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;

    if (line.startsWith('- ')) {
      const item = parseInline(line.slice(2).trim());
      const tail = blocks.at(-1);
      // Consecutive bullets extend the list rather than starting a new one,
      // so a run of them renders as a single <ul>.
      if (tail?.kind === 'list') tail.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
      continue;
    }

    blocks.push({ kind: 'para', spans: parseInline(line) });
  }

  return blocks;
}
