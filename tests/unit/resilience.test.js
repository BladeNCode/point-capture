// Two fallback paths that only run when something has already gone wrong, so
// nothing exercises them in normal use and a bug there stays hidden until the
// exact moment it hurts. Both were the weakest coverage in app/store:
// uuid.js at 50%, sound-prefs.js at 62.5% branch.
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('uuid() without a secure context', () => {
  // crypto.randomUUID requires a secure context. On plain HTTP — a referee on
  // a venue network, or the LAN dev server without certs — it is undefined and
  // the getRandomValues fallback runs instead. These ids are boutIds: domain
  // identities generated client-side, referenced by every later event. A
  // malformed or colliding id here corrupts a bout's whole history.
  const freshUuid = async () => {
    vi.resetModules();
    return (await import('../../app/store/uuid.js')).uuid;
  };

  it('still produces a well-formed v4 uuid', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: arr => { arr[0] = 0x5a; return arr; },
    });
    const uuid = await freshUuid();

    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not repeat itself across calls', async () => {
    // Uses real randomness, so this is the property that actually matters:
    // distinct bouts must not collide.
    let n = 0;
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: arr => { arr[0] = (n += 37) & 0xff; return arr; },
    });
    const uuid = await freshUuid();

    const ids = new Set([uuid(), uuid(), uuid(), uuid()]);
    expect(ids.size).toBe(4);
  });

  it('prefers randomUUID when it is available', async () => {
    const randomUUID = vi.fn(() => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: arr => arr });
    const uuid = await freshUuid();

    expect(uuid()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(randomUUID).toHaveBeenCalled();
  });
});

describe('sound preferences when storage is unavailable', () => {
  // Private mode, blocked site data, or a corrupt value. The stated contract is
  // that a preference read must never break the capture screen — a referee
  // mid-bout should lose their beep setting, not the bout.
  const freshPrefs = async () => {
    vi.resetModules();
    return import('../../app/store/sound-prefs.js');
  };

  it('falls back to defaults when reading throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('denied', 'SecurityError'); },
      setItem: () => {},
    });
    const { loadSoundPrefs } = await freshPrefs();

    const prefs = loadSoundPrefs();
    expect(prefs.enabled).toBe(true);
    expect(prefs.warnAt).toEqual([30]);
  });

  it('falls back to defaults on corrupt JSON rather than throwing', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {} });
    const { loadSoundPrefs } = await freshPrefs();

    expect(() => loadSoundPrefs()).not.toThrow();
    expect(loadSoundPrefs().enabled).toBe(true);
  });

  it('ignores a stored value of the wrong shape', async () => {
    // A hand-edited or older-build value must not reach the sound code as-is.
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ enabled: 'yes', volume: 'loud', warnAt: 'all' }),
      setItem: () => {},
    });
    const { loadSoundPrefs } = await freshPrefs();

    const prefs = loadSoundPrefs();
    expect(prefs.enabled).toBe(true);        // non-boolean -> default
    expect(prefs.volume).toBe(1);            // non-finite -> default
    expect(prefs.warnAt).toEqual([30]);      // non-array -> default
  });

  it('still applies the setting for this session when writing fails', async () => {
    // Saving is best-effort: a blocked write must not surface as an error to
    // someone who just toggled a switch.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    });
    const { saveSoundPrefs } = await freshPrefs();

    expect(() => saveSoundPrefs({ enabled: false, volume: 0.5, warnAt: [10] })).not.toThrow();
    expect(saveSoundPrefs({ enabled: false, volume: 0.5, warnAt: [10] }).enabled).toBe(false);
  });
});
