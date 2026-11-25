import { sharedReducer } from '../shared/schema/reducer.js';
import { BOUT_CREATED } from '../shared/vocabulary/events.js';

// Composition pattern: the shared reducer (fencing-shared/schema/reducer.js,
// symlinked at app/shared/schema/) handles the genuinely shared Bout/
// Touch/Officiating event surface (doc 01/06). This layer runs on top for
// Point-Assaut-specific extensions to shared entities (presetId isn't part
// of the shared Bout schema — doc 09 §1a) and, from Phase 2 on, fully
// app-local event types (Session grouping, Capture Presets CRUD).
export function reducer(state, event) {
  state = sharedReducer(state, event);
  const { type, payload } = event;

  switch (type) {
    case BOUT_CREATED: {
      const existingBout = state.bouts?.[payload.boutId];
      return {
        ...state,
        bouts: { ...state.bouts, [payload.boutId]: { ...existingBout, presetId: payload.presetId } },
      };
    }

    default:
      return state;
  }
}
