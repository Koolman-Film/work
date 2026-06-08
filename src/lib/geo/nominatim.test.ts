import { describe, expect, it } from 'vitest';
import { parseNominatimResults } from './nominatim';

describe('parseNominatimResults', () => {
  it('maps valid Nominatim rows to GeoResult[]', () => {
    const raw = [
      { display_name: 'CentralWorld, Bangkok', lat: '13.7466', lon: '100.5396' },
      { display_name: 'Central Rama 9', lat: '13.758', lon: '100.565' },
    ];
    expect(parseNominatimResults(raw)).toEqual([
      { displayName: 'CentralWorld, Bangkok', lat: 13.7466, lng: 100.5396 },
      { displayName: 'Central Rama 9', lat: 13.758, lng: 100.565 },
    ]);
  });

  it('returns [] for non-array input', () => {
    expect(parseNominatimResults(null)).toEqual([]);
    expect(parseNominatimResults({})).toEqual([]);
    expect(parseNominatimResults('nope')).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(parseNominatimResults([])).toEqual([]);
  });

  it('drops rows missing display_name', () => {
    expect(parseNominatimResults([{ lat: '13.7', lon: '100.5' }])).toEqual([]);
  });

  it('drops rows with non-numeric or out-of-range coordinates', () => {
    const raw = [
      { display_name: 'bad lat', lat: 'abc', lon: '100.5' },
      { display_name: 'lat out of range', lat: '95', lon: '100.5' },
      { display_name: 'lng out of range', lat: '13.7', lon: '200' },
      { display_name: 'ok', lat: '13.7', lon: '100.5' },
    ];
    expect(parseNominatimResults(raw)).toEqual([{ displayName: 'ok', lat: 13.7, lng: 100.5 }]);
  });

  it('ignores non-object entries', () => {
    const raw = [null, 42, 'str', { display_name: 'ok', lat: '1', lon: '2' }];
    expect(parseNominatimResults(raw)).toEqual([{ displayName: 'ok', lat: 1, lng: 2 }]);
  });
});
