import { describe, it, expect, beforeEach } from 'vitest';
import { boot, dispatch, subscribe, getState, reset } from '../../_lib/core/store/store.js';
import { reducer } from '../../app/store/reducer.js';

let dbSeq = 0;
function freshName() { return `Point Capture-store-${dbSeq++}`; }

beforeEach(() => reset());

describe('Store integration', () => {
  it('boots with empty state when no events exist', async () => {
    await boot({ dbName: freshName(), reducer });
    expect(getState()).toEqual({});
  });

  it('state persists across a simulated reload', async () => {
    const name = freshName();
    await boot({ dbName: name, reducer });
    await dispatch('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} });
    reset();
    await boot({ dbName: name, reducer });
    expect(getState().bouts.b1).toMatchObject({ weapon: 'foil', status: 'in-progress' });
  });

  it('subscriber is called when state changes', async () => {
    await boot({ dbName: freshName(), reducer });
    let received;
    subscribe('bouts', val => { received = val; });
    await dispatch('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} });
    expect(received.b1).toMatchObject({ weapon: 'foil' });
  });

  it('a full capture loop replays correctly after reload: create, score, void, complete', async () => {
    // Socle's replay ordering (_lib/core/store/store.js's _sortEvents) sorts
    // by recordedAt, tie-broken by deviceId — insufficient to disambiguate
    // several same-device events dispatched within the same millisecond, as
    // this test does back-to-back. Not a real-world concern (a human can't
    // tap twice within 1ms), so the honest fix is a tiny delay between
    // dispatches here, not a workaround for a scenario that can't occur from
    // actual tapping.
    const tick = () => new Promise(r => setTimeout(r, 2));

    const name = freshName();
    await boot({ dbName: name, reducer });
    await dispatch('bout:created', { boutId: 'b1', weapon: 'epee', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } } });
    await tick();
    await dispatch('touch:scored', { boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 } });
    await tick();
    await dispatch('touch:scored', { boutId: 'b1', scoredBy: 'B', valid: true, scoreAfter: { A: 1, B: 1 } });
    await tick();
    const touches = getState().touchesByBout.b1;
    await dispatch('touch:voided', { boutId: 'b1', targetEventId: touches[0].eventId, reason: 'mis-tap' });
    await tick();
    await dispatch('bout:completed', { boutId: 'b1' });

    reset();
    await boot({ dbName: name, reducer });

    expect(getState().bouts.b1).toMatchObject({ status: 'complete', scoreAfter: { A: 0, B: 1 } });
    expect(getState().touchesByBout.b1.find(t => t.eventId === touches[0].eventId).voided).toBe(true);
  });
});
