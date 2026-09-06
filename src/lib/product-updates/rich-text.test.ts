import { describe, expect, it } from 'vitest';
import { type Block, parseBody, parseInline } from './rich-text';

describe('parseInline', () => {
  it('returns one plain span for unmarked text', () => {
    expect(parseInline('hello')).toEqual([{ text: 'hello' }]);
  });

  it('marks bold, italic and highlight', () => {
    expect(parseInline('**b**')).toEqual([{ text: 'b', bold: true }]);
    expect(parseInline('_i_')).toEqual([{ text: 'i', italic: true }]);
    expect(parseInline('==h==')).toEqual([{ text: 'h', mark: true }]);
  });

  it('keeps the text around a run', () => {
    expect(parseInline('a **b** c')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
  });

  it('handles several runs in one line', () => {
    expect(parseInline('**a**_b_==c==')).toEqual([
      { text: 'a', bold: true },
      { text: 'b', italic: true },
      { text: 'c', mark: true },
    ]);
  });

  it('leaves an unmatched delimiter as literal text', () => {
    // The failure mode this guards: a greedy or unanchored parser swallowing
    // the rest of the paragraph after a stray asterisk in translated copy.
    expect(parseInline('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6' }]);
    expect(parseInline('**unclosed')).toEqual([{ text: '**unclosed' }]);
  });

  it('is not confused by ** immediately following a bold run', () => {
    expect(parseInline('**a** and **b**')).toEqual([
      { text: 'a', bold: true },
      { text: ' and ' },
      { text: 'b', bold: true },
    ]);
  });

  it('works on Thai, which has no inter-word spaces', () => {
    expect(parseInline('ตั้งแต่ ==27 ก.ย. 2569== เป็นต้นไป')).toEqual([
      { text: 'ตั้งแต่ ' },
      { text: '27 ก.ย. 2569', mark: true },
      { text: ' เป็นต้นไป' },
    ]);
  });

  it('is reusable — the shared regex does not carry lastIndex between calls', () => {
    // A module-level /g regex is stateful; calling exec twice without resetting
    // lastIndex silently drops the first match of the second call.
    const first = parseInline('**a**');
    const second = parseInline('**a**');
    expect(second).toEqual(first);
  });
});

describe('parseBody', () => {
  it('makes one paragraph per line', () => {
    expect(parseBody('one\ntwo')).toEqual<Block[]>([
      { kind: 'para', spans: [{ text: 'one' }] },
      { kind: 'para', spans: [{ text: 'two' }] },
    ]);
  });

  it('drops blank lines', () => {
    expect(parseBody('one\n\n\ntwo')).toHaveLength(2);
  });

  it('groups consecutive bullets into a single list', () => {
    expect(parseBody('- a\n- b')).toEqual<Block[]>([
      { kind: 'list', items: [[{ text: 'a' }], [{ text: 'b' }]] },
    ]);
  });

  it('closes a list when prose resumes', () => {
    const blocks = parseBody('intro\n- a\n- b\noutro');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'list', 'para']);
  });

  it('starts a fresh list after intervening prose', () => {
    const blocks = parseBody('- a\nmid\n- b');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'para', 'list']);
  });

  it('parses inline markup inside bullets', () => {
    expect(parseBody('- ตั้งแต่ **27 ก.ย.**')).toEqual<Block[]>([
      { kind: 'list', items: [[{ text: 'ตั้งแต่ ' }, { text: '27 ก.ย.', bold: true }]] },
    ]);
  });

  it('does not treat a hyphen mid-line as a bullet', () => {
    expect(parseBody('a - b')).toEqual<Block[]>([{ kind: 'para', spans: [{ text: 'a - b' }] }]);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseBody('')).toEqual([]);
    expect(parseBody('  \n \n')).toEqual([]);
  });
});
