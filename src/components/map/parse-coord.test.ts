import { describe, expect, it } from 'vitest';
import { parseCoordInput } from './parse-coord';

describe('parseCoordInput', () => {
  it('treats empty / whitespace as a cleared coordinate (null)', () => {
    expect(parseCoordInput('', 'lat')).toEqual({ ok: true, value: null });
    expect(parseCoordInput('   ', 'lng')).toEqual({ ok: true, value: null });
  });

  it('parses valid in-range numbers', () => {
    expect(parseCoordInput('13.7563', 'lat')).toEqual({ ok: true, value: 13.7563 });
    expect(parseCoordInput('100.5018', 'lng')).toEqual({ ok: true, value: 100.5018 });
    expect(parseCoordInput('-13.5', 'lat')).toEqual({ ok: true, value: -13.5 });
  });

  it('accepts a trailing-dot partial as the parsed integer', () => {
    expect(parseCoordInput('13.', 'lat')).toEqual({ ok: true, value: 13 });
  });

  it('rejects a lone minus sign (not yet a number)', () => {
    expect(parseCoordInput('-', 'lat')).toEqual({ ok: false });
  });

  it('rejects non-numeric garbage', () => {
    expect(parseCoordInput('abc', 'lat')).toEqual({ ok: false });
    expect(parseCoordInput('13abc', 'lng')).toEqual({ ok: false });
  });

  it('enforces latitude bounds [-90, 90]', () => {
    expect(parseCoordInput('90', 'lat')).toEqual({ ok: true, value: 90 });
    expect(parseCoordInput('-90', 'lat')).toEqual({ ok: true, value: -90 });
    expect(parseCoordInput('90.0001', 'lat')).toEqual({ ok: false });
    expect(parseCoordInput('91', 'lat')).toEqual({ ok: false });
  });

  it('enforces longitude bounds [-180, 180]', () => {
    expect(parseCoordInput('180', 'lng')).toEqual({ ok: true, value: 180 });
    expect(parseCoordInput('-180', 'lng')).toEqual({ ok: true, value: -180 });
    expect(parseCoordInput('181', 'lng')).toEqual({ ok: false });
  });

  it('applies the correct bound per kind (120 is a valid lng but not a valid lat)', () => {
    expect(parseCoordInput('120', 'lat')).toEqual({ ok: false });
    expect(parseCoordInput('120', 'lng')).toEqual({ ok: true, value: 120 });
  });
});
