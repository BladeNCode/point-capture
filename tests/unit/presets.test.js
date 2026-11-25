import { describe, it, expect } from 'vitest';
import {
  PRESETS, DEFAULT_PRESET_ID, getPreset,
  isOnTarget, WEAPON_TARGET_ZONES,
  DEFAULT_FORMAT_PRESET_ID, getFormatPreset,
} from '../../app/store/presets.js';

describe('presets', () => {
  it('ships exactly the 3 Phase 1 starter presets', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['referee-basic', 'standard', 'full-analyst']);
  });

  it('defaults to Referee/Basic', () => {
    expect(DEFAULT_PRESET_ID).toBe('referee-basic');
  });

  it('getPreset returns the matching preset', () => {
    // Presets carry a string KEY, not English text — the label lives in the
    // string table so it can be translated. Asserting the key keeps this test
    // from breaking every time the wording changes.
    expect(getPreset('standard').labelKey).toBe('capture-preset.standard');
  });

  it('getPreset falls back to the default for an unknown or missing id', () => {
    expect(getPreset('does-not-exist').id).toBe('referee-basic');
    expect(getPreset(undefined).id).toBe('referee-basic');
  });

  it('Referee/Basic enables no detail-entry fields', () => {
    const { fields } = getPreset('referee-basic');
    expect(fields.actionType || fields.pisteLocation || fields.bodyLocation).toBe(false);
  });

  it('Full/Analyst enables every field', () => {
    const { fields } = getPreset('full-analyst');
    expect(Object.values(fields).every(Boolean)).toBe(true);
  });
});

describe('weapon target zones', () => {
  it('foil: torso only is on-target', () => {
    expect(isOnTarget('foil', 'torso')).toBe(true);
    expect(isOnTarget('foil', 'arm')).toBe(false);
    expect(isOnTarget('foil', 'leg')).toBe(false);
    expect(isOnTarget('foil', 'head')).toBe(false);
  });

  it('epee: whole body is on-target', () => {
    for (const zone of ['head', 'torso', 'arm', 'leg']) {
      expect(isOnTarget('epee', zone)).toBe(true);
    }
  });

  it('sabre: waist-up excluding legs is on-target', () => {
    expect(isOnTarget('sabre', 'head')).toBe(true);
    expect(isOnTarget('sabre', 'torso')).toBe(true);
    expect(isOnTarget('sabre', 'arm')).toBe(true);
    expect(isOnTarget('sabre', 'leg')).toBe(false);
  });

  it('WEAPON_TARGET_ZONES covers exactly the 3 weapons', () => {
    expect(Object.keys(WEAPON_TARGET_ZONES).sort()).toEqual(['epee', 'foil', 'sabre']);
  });
});

describe('format presets', () => {
  it('defaults to Pool', () => {
    expect(DEFAULT_FORMAT_PRESET_ID).toBe('pool');
  });

  it('Pool targets 5 touches over a single period', () => {
    const { format } = getFormatPreset('pool');
    expect(format).toMatchObject({ targetScore: 5, periodCount: 1 });
  });

  it('Direct Elimination targets 15 touches over 3 periods', () => {
    const { format } = getFormatPreset('de');
    expect(format).toMatchObject({ targetScore: 15, periodCount: 3 });
  });

  it('Custom has no fixed format — signals the UI to use user-entered values', () => {
    expect(getFormatPreset('custom').format).toBeNull();
  });

  it('getFormatPreset falls back to the default for an unknown id', () => {
    expect(getFormatPreset('nope').id).toBe(DEFAULT_FORMAT_PRESET_ID);
  });
});
