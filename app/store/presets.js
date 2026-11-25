// Phase 1: hardcoded starter presets, no CRUD yet (that's Phase 2 — see
// planning doc 09 §1a/§7). Each preset is a named bundle of which optional
// capture fields are shown; it never changes what a touch:scored event can
// contain, only what the Capture screen offers to fill in.
export const PRESETS = [
  {
    id: 'referee-basic',
    labelKey: 'capture-preset.referee-basic',
    fields: { actionType: false, pisteLocation: false, bodyLocation: false, contextTags: false, attemptedActions: false, officiating: true },
  },
  {
    id: 'standard',
    labelKey: 'capture-preset.standard',
    fields: { actionType: true, pisteLocation: true, bodyLocation: true, contextTags: false, attemptedActions: false, officiating: true },
  },
  {
    id: 'full-analyst',
    labelKey: 'capture-preset.full-analyst',
    fields: { actionType: true, pisteLocation: true, bodyLocation: true, contextTags: true, attemptedActions: true, officiating: true },
  },
];

export const DEFAULT_PRESET_ID = PRESETS[0].id;

export function getPreset(id) {
  return PRESETS.find(p => p.id === id) ?? PRESETS[0];
}

// Placeholder flat action-type list (per doc 06's own open item — the real
// hierarchical per-weapon taxonomy tree is later content work).
export const ACTION_TYPES = ['attack', 'riposte', 'counter-attack', 'remise'];

// Simple zone pickers (doc 09 §2: zone-based, not precise coordinate
// placement, for V1). Same physical-location taxonomy for every weapon —
// what counts as *on-target* varies by weapon (see WEAPON_TARGET_ZONES
// below), but where a touch physically landed is worth recording either
// way (an off-target hit is still real training data).
export const PISTE_ZONES = ['left', 'center', 'right'];
export const BODY_ZONES = ['head', 'torso', 'arm', 'leg'];

// FIE valid-target areas per weapon (doc 10's gap analysis):
// - Foil: torso only — everything else is a real, callable "off-target"
//   touch (registers on the apparatus, doesn't score).
// - Épée: whole body — there's no off-target concept at all.
// - Sabre: waist-up, excluding hands — legs don't even register as a
//   touch, on- or off-target.
// Used to auto-suggest (not force) `valid` when a body zone is picked
// during capture, per weapon.
export const WEAPON_TARGET_ZONES = {
  foil: ['torso'],
  epee: ['head', 'torso', 'arm', 'leg'],
  sabre: ['head', 'torso', 'arm'],
};

export function isOnTarget(weapon, zone) {
  return (WEAPON_TARGET_ZONES[weapon] ?? BODY_ZONES).includes(zone);
}

// Bout format presets — a separate concept from the capture presets above.
// These configure the bout's *scoring rules* (target score, period
// structure), not what capture fields are visible. App-local (Point
// Assaut), even though the resulting `format` shape on Bout is shared
// schema (doc 06) — same split as capture presets vs. touch:scored.
export const FORMAT_PRESETS = [
  { id: 'pool', labelKey: 'preset.pool', format: { targetScore: 5, periodLengthSeconds: 180, periodCount: 1 } },
  { id: 'de', labelKey: 'preset.de', format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 } },
  { id: 'custom', labelKey: 'preset.custom', format: null }, // null signals "use the custom fields the user filled in"
];

export const DEFAULT_FORMAT_PRESET_ID = FORMAT_PRESETS[0].id;

export function getFormatPreset(id) {
  return FORMAT_PRESETS.find(p => p.id === id) ?? FORMAT_PRESETS[0];
}
