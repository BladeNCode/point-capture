// Clock-sound preferences. Deliberately localStorage rather than the event
// store: this is a property of *this device in this hall* (phone on silent,
// noisy venue, referee who finds it annoying), not of the bout — so it must
// not travel inside an exported bout file, and it must not replay as a
// domain event. Same reasoning as the anti-profiling local tags in doc 09,
// for a much less sensitive reason.
const KEY = 'point-capture:clock-sound';

// Seconds-remaining marks the clock can beep at. 30s is on by default: it
// is the one most referees want and the least intrusive, and a referee who
// never opens the settings still gets a useful warning.
export const WARNING_MARKS = [60, 30, 10];

const DEFAULTS = { enabled: true, volume: 1, warnAt: [30] };

export function loadSoundPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      volume: clampVolume(parsed?.volume),
      warnAt: cleanMarks(parsed?.warnAt),
    };
  } catch {
    // Private mode, blocked site data, or corrupt JSON — never let a
    // preference read break the capture screen.
    return { ...DEFAULTS };
  }
}

export function saveSoundPrefs({ enabled, volume, warnAt }) {
  const prefs = {
    enabled: Boolean(enabled),
    volume: clampVolume(volume),
    warnAt: cleanMarks(warnAt),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Non-fatal: the setting still applies for this session.
  }
  return prefs;
}

// Only the marks we actually offer, in a stable order — a stored value
// from an older build (or a hand-edited one) can't introduce a mark the
// settings screen has no control for.
function cleanMarks(value) {
  if (!Array.isArray(value)) return [...DEFAULTS.warnAt];
  return WARNING_MARKS.filter(mark => value.includes(mark));
}

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.volume;
  return Math.min(1, Math.max(0, n));
}
