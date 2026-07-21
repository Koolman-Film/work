/**
 * Regression guard for the 2026-07-20 false-positive: employees standing
 * INSIDE the geofence were sent to the admin review queue every day because
 * their phone's camera permission was off.
 *
 * The behavioural assertions live in check-in.test.ts ("a fallback selfie
 * never disputes on its own"), since the rule now lives in submitCheckIn.
 * What this file pins is the SHAPE: selfie-provenance must not export any
 * decision function. If a future change reintroduces one, this fails and
 * sends the author to the evidence in the module header.
 */

import { describe, expect, it } from 'vitest';
import * as provenance from './selfie-provenance';

describe('selfie-provenance module surface', () => {
  it('exports no runtime decision logic — provenance is recorded, never judged', () => {
    expect(Object.keys(provenance)).toEqual([]);
  });
});
