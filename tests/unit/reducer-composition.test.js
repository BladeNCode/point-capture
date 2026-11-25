import { describe, it, expect } from 'vitest';
import { reducer } from '../../app/store/reducer.js';

function evt(type, payload, overrides = {}) {
  return { id: overrides.id ?? `evt-${type}-${Math.random()}`, deviceId: 'dev-1', recordedAt: 1, occurredAt: overrides.occurredAt ?? 1000, type, payload };
}

// This app's own reducer composes the shared reducer (fencing-shared/
// schema/reducer.js, symlinked at app/shared/schema/) with Point-Assaut-
// specific extensions — see app/store/reducer.js. Behavior common to every
// fencing app is covered by reducer.test.js against the shared reducer
// directly; this file only covers what this app's own layer adds on top.
describe('reducer (app/store/reducer.js — Point Capture composition layer)', () => {
  it('still produces the full shared Bout shape via delegation', () => {
    const state = reducer({}, evt('bout:created', {
      boutId: 'b1', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } },
    }, { occurredAt: 5000 }));

    expect(state.bouts.b1).toMatchObject({
      id: 'b1', weapon: 'foil', status: 'in-progress', scoreAfter: { A: 0, B: 0 }, createdAt: 5000,
    });
  });

  it('attaches presetId — an app-local extension, not part of the shared Bout schema', () => {
    const state = reducer({}, evt('bout:created', {
      boutId: 'b1', weapon: 'epee', participants: {}, presetId: 'full-analyst',
    }));

    expect(state.bouts.b1.presetId).toBe('full-analyst');
  });

  it('leaves presetId undefined when none is given, rather than throwing', () => {
    const state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'sabre', participants: {} }));
    expect(state.bouts.b1.presetId).toBeUndefined();
  });
});
