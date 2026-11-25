// Display formatting shared by the Capture screen and its bout log.
//
// Lifted out of capture-page.js, which had grown to 1400 lines. These are the
// pure value->string helpers; the log-row builders that use them live next
// door in bout-log.js, and the component keeps only DOM wiring.
//
// Everything here resolves strings through t() at call time rather than at
// module load, so a locale change reaches text already rendered.
import { t } from '../../../_lib/core/strings.js';

export const CARD_TYPES = ['yellow', 'red', 'black'];
// The colour is the fastest way to read a penalty row — the word alone made
// every card row look alike when scanning.
export const CARD_MARK = { yellow: '🟨', red: '🟥', black: '⬛️' };

// Mid-sentence card name, from the shared table — never cardName().toLowerCase(),
// which is wrong in any language that capitalises nouns.
export const cardInline = type => (typeof type === 'string' ? t(`card.${type}.inline`) : '');
export const cardMark = type => (CARD_MARK[type] ? `${CARD_MARK[type]} ` : '');

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Until fencers can be named, they're the colours they're actually sitting
// in on screen — a referee reads "Green" off the left half, where "A" is an
// internal slot id that means nothing on the piste. The slot ids stay in the
// data; this is purely what humans see.
// Resolved per call rather than at module load, so a locale change reaches
// rows already rendered.
const sideNameKey = side => `side.${side}`;

export function sideName(side) {
  return side === 'A' || side === 'B' ? t(sideNameKey(side)) : side;
}

// Raw (unescaped) — every call site below assigns to .textContent or an
// attribute that touch-target reflects into .textContent, both inherently
// injection-safe. escapeHtml() is reserved for the innerHTML template
// strings further down (the touch log rows, the card columns).
export function sideLabel(bout, side) {
  return bout?.participants?.[side]?.label || sideName(side);
}

// mm:ss remaining — the figure on the clock at the moment it happened,
// which is what the referee actually saw and what a video or paper sheet
// can be reconciled against.
//
// Prefixed with the period when the bout has more than one, because the
// clock restarts each period: "2:35" alone appears several times in a DE
// bout and says nothing about which one. Single-period bouts omit it, for
// the same reason the clock omits "Period 1 of 1".
export function clockStampText(e, showPeriod) {
  const seconds = Number(e?.matchClockSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  const period = Number(e?.period);
  const prefix = showPeriod && Number.isFinite(period) ? `P${period} ` : '';
  return `${prefix}${m}:${s}`;
}

// NB: the touch is `touch`, not `t` — `t` is the translate function, and a
// parameter named `t` silently shadowed it here.
