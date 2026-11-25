import { defineStrings } from '../_lib/core/strings.js';
import { en as sharedEn } from './shared/strings/en.js';

// MUST stay the first import in main.js. defineStrings() runs as a module-load
// side effect, and a component that renders before this file has loaded calls
// t() against an empty table — which does not throw, it silently renders the
// key. "card-picker.cancel" on a button is the symptom.

// The shared fencing components' own strings, registered by the app because
// fencing-shared/strings/en.js deliberately imports nothing — not even Socle.
// Registered first so an app-specific key below can deliberately override one.
defineStrings(sharedEn);

defineStrings({
  'update-banner.available': 'Update available',
  'update-banner.reload':    'Reload',
  'update-banner.dismiss':   'Dismiss',

  'toast.close':             '×',

  // ── Enum display values ──────────────────────────────────────────────────
  // Weapon and status are stored as the enum value on the event and were
  // being rendered raw, which meant the list showed "foil" and "in-progress"
  // verbatim. A stored value is data and must never reach the screen
  // untranslated — these maps are the only place the two are allowed to meet.
  'weapon.foil':   'Foil',
  'weapon.epee':   'Épée',
  'weapon.sabre':  'Sabre',
  'status.in-progress': 'in progress',
  'status.complete':    'complete',

  // The sides, when a fencer has not been named. Colours, not translations of
  // colours — these match the piste ends and the app's own green/red fields,
  // so a translator should keep whatever word names those colours locally.
  'side.A': 'Green',
  'side.B': 'Red',

  // ── Bout list ────────────────────────────────────────────────────────────
  'home.new-bout':   'New Bout',
  'home.empty':      'No bouts yet — tap New Bout to start.',
  'home.vs':         '{a} vs {b}',
  'home.untitled':   'Bout',
  'home.ended':      'ended {when}',
  'home.deleted':    'Bout deleted',

  // ── New-bout dialog ──────────────────────────────────────────────────────
  'new-bout.title':        'New bout',
  'new-bout.weapon':       'Weapon',
  'new-bout.format':       'Format',
  'new-bout.target-score': 'Target score',
  'new-bout.period-length': 'Period length (s)',
  'new-bout.period-count': 'Number of periods',
  // Placeholders show an example value, so the number stays in the string —
  // a translator may well want a different separator or no "e.g." at all.
  'new-bout.eg-target':    'e.g. 15',
  'new-bout.eg-length':    'e.g. 180',
  'new-bout.eg-count':     'e.g. 3',
  'new-bout.cancel':       'Cancel',
  'new-bout.start':        'Start',

  // ── Format presets ───────────────────────────────────────────────────────
  'preset.pool':   'Pool (5 touches)',
  'preset.de':     'Direct Elimination (15 touches)',
  'preset.custom': 'Custom',

  // ── Capture presets ──────────────────────────────────────────────────────
  'capture-preset.referee-basic': 'Referee / Basic',
  'capture-preset.standard':      'Standard',
  'capture-preset.full-analyst':  'Full / Analyst',

  // ── Capture screen: chrome ───────────────────────────────────────────────
  'capture.back':         'Back to bout list',
  'capture.actions':      'Bout actions',
  'capture.log.show':     'Show bout log',
  'capture.log.hide':     'Hide bout log',
  'capture.log.empty':    'Nothing logged yet.',
  'capture.log.hint':     'Swipe a touch left to void it.',
  'capture.end-bout':     'End bout',
  'capture.next-period':  'Next period',
  'capture.prev-period':  'Back to previous period',
  // The DOUBLE pill collapses to '+' when the log is open, so the long form
  // needs to stay short enough for a compact pill in any language.
  'capture.double':       'DOUBLE',
  'capture.double.short': '+',
  'capture.hold-to-score': 'Hold to score',

  // ── Capture screen: log rows ─────────────────────────────────────────────
  // {score} is pre-formatted as "3–2" — an en dash between two numerals, which
  // is punctuation rather than language, so it is not a translatable fragment.
  'capture.row.touch':      '{fencer} — {score}',
  'capture.row.double':     'Double — {score}',
  // A voided row carries no score — see bout-log.js for why. Kept as keys
  // rather than hardcoded so a translator can mark them if their language
  // wants something more than the bare name ("Green (annulled)").
  'capture.row.touch.voided':  '{fencer}',
  'capture.row.double.voided': 'Double',
  'capture.row.card':       '{mark}{card} card',
  'capture.row.card-withdrawn': '{mark}{card} card withdrawn',
  'capture.row.timeout':    'timeout',
  'capture.row.card-for':   '{mark}{card} card for {fencer}',
  'capture.row.period':     'Period {period}',

  // ── Capture screen: settings ─────────────────────────────────────────────
  'capture.sound.title':  'Clock sound',
  'capture.sound.toggle': 'Beep when the clock starts and stops',
  'capture.sound.volume': 'Volume',
  'capture.sound.warn':   'Warn when time is nearly up',
  'capture.sound.close':  'Close',

  // ── Capture screen: confirmations ────────────────────────────────────────
  'capture.void.title':        'Void touch',
  'capture.void.touch':        'Void this touch? It stays in the log, struck through, for audit.',
  'capture.void.card':         'Withdraw this card?',
  'capture.void.card-point':   'Withdraw this red card? The point it awarded goes back too.',
  'capture.void.double':       'Void this double touch? Both fencers lose the point.',
  'capture.void.cancel':       'Cancel',
  'capture.void.confirm':      'Void',
  'capture.complete.title':    'End bout',
  'capture.complete.prompt':   'End this bout?',
  'capture.complete.at':       'End this bout at {a} {scoreA} – {scoreB} {b}?',
  'capture.complete.note':     'Going back with ‹ instead leaves it in progress, so you can pick it up later.',
  'capture.complete.cancel':   'Keep going',
  'capture.complete.confirm':  'End bout',

  // ── Capture screen: announcements ────────────────────────────────────────
  'capture.toast.priority':     'Time — scores level. Assign priority.',
  'capture.toast.final-over':   'Time — final period over',
  'capture.toast.period-end':   'End of period',
  'capture.toast.complete':     'Bout complete',
  'capture.toast.card':         '{card} card — {fencer}',
  'capture.toast.card-revoked': '{card} card withdrawn — {fencer}',

  // ── Delete confirmation ──────────────────────────────────────────────────
  'delete-bout.title':   'Delete bout',
  'delete-bout.prompt':  'Delete this bout? It stays in the log for audit, but disappears from your list.',
  'delete-bout.cancel':  'Cancel',
  'delete-bout.confirm': 'Delete',
});

// ─────────────────────────────────────────────────────────────────────────────
// A NOTE ON PLURALS, because the next person will hit it
//
// Socle's t() does {param} substitution and nothing else — no plural rules, no
// gender, no ordinals. Where English needs two forms we ship two keys and pick
// between them at the call site (see card-rack.red.one / .red.other).
//
// That is honest for English and insufficient for most languages: Polish needs
// four forms, Arabic six. Do NOT extend the two-key pattern into a general
// plural rule — a half-rule reads as working while being wrong nearly
// everywhere. When a real second locale arrives, reach for Intl.PluralRules at
// the call sites that need it, which is currently exactly one.
//
// A NOTE ON WHAT IS NOT TRANSLATED
//
// Screen-reader labels in the shared components ARE keyed, because they are
// the only strings that count things and leaving them hardcoded would hide the
// plural problem rather than solve it. But this app does not target screen
// readers — it is a purely visual interface and will not work for a blind
// fencer — so those labels are not a priority to translate well, only to keep
// translatable.
// ─────────────────────────────────────────────────────────────────────────────
