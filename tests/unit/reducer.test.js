import { describe, it, expect } from 'vitest';
import { sharedReducer as reducer } from '../../app/shared/schema/reducer.js';

function evt(type, payload, overrides = {}) {
  return { id: overrides.id ?? `evt-${type}-${Math.random()}`, deviceId: 'dev-1', recordedAt: 1, occurredAt: overrides.occurredAt ?? 1000, type, payload };
}

describe('sharedReducer (fencing-shared/schema/reducer.js)', () => {
  describe('bout:created', () => {
    it('creates a bout in-progress with zero score', () => {
      const state = reducer({}, evt('bout:created', {
        boutId: 'b1', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } },
      }, { occurredAt: 5000 }));

      expect(state.bouts.b1).toEqual({
        id: 'b1', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } },
        videoRef: undefined, format: undefined, status: 'in-progress', scoreAfter: { A: 0, B: 0 },
        cardCounts: { A: { yellow: 0, red: 0, black: 0 }, B: { yellow: 0, red: 0, black: 0 } },
        priority: null, createdAt: 5000, lastActivityAt: 5000,
      });
    });
  });

  describe('touch:scored', () => {
    it('appends the touch and updates the bout scoreAfter', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', {
        boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 },
      }, { id: 'e1' }));

      expect(state.bouts.b1.scoreAfter).toEqual({ A: 1, B: 0 });
      expect(state.touchesByBout.b1).toEqual([
        { eventId: 'e1', id: 'e1', occurredAt: 1000, boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 }, voided: false },
      ]);
    });

    it('accumulates multiple touches in order', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 } }, { id: 'e1' }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'B', valid: true, scoreAfter: { A: 1, B: 1 } }, { id: 'e2' }));

      expect(state.bouts.b1.scoreAfter).toEqual({ A: 1, B: 1 });
      expect(state.touchesByBout.b1.map(t => t.eventId)).toEqual(['e1', 'e2']);
    });

    it('an invalid touch is logged but the reducer trusts the payload scoreAfter as-is', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', {
        boutId: 'b1', scoredBy: 'A', valid: false, scoreAfter: { A: 0, B: 0 },
      }, { id: 'e1' }));

      expect(state.touchesByBout.b1[0].valid).toBe(false);
      expect(state.bouts.b1.scoreAfter).toEqual({ A: 0, B: 0 });
    });
  });

  describe('touch:scored — score sanitization at the import trust boundary', () => {
    // Events reach the reducer from imported bout files (doc 09 UC4), so a
    // payload score is untrusted input the same way a participant label is.
    // Both the bout total and the touch's own copy must come out as plain
    // non-negative integers, since consumers interpolate them into HTML.
    const scoreFromPayload = payloadScore => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', {
        boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: payloadScore,
      }, { id: 'e1' }));
      return { bout: state.bouts.b1.scoreAfter, touch: state.touchesByBout.b1[0].scoreAfter };
    };

    it('strips an injected HTML string down to a number', () => {
      const { bout, touch } = scoreFromPayload({ A: '<img src=x onerror=alert(1)>', B: 0 });
      expect(bout).toEqual({ A: 0, B: 0 });
      expect(touch).toEqual({ A: 0, B: 0 });
    });

    it('rejects negative, fractional and non-numeric scores', () => {
      expect(scoreFromPayload({ A: -5, B: 2.7 }).bout).toEqual({ A: 0, B: 2 });
      expect(scoreFromPayload({ A: null, B: undefined }).bout).toEqual({ A: 0, B: 0 });
      expect(scoreFromPayload({ A: NaN, B: Infinity }).bout).toEqual({ A: 0, B: 0 });
    });

    it('leaves a legitimate numeric score untouched', () => {
      expect(scoreFromPayload({ A: 7, B: 12 }).bout).toEqual({ A: 7, B: 12 });
    });

    it('survives a missing scoreAfter entirely', () => {
      expect(scoreFromPayload(undefined).bout).toEqual({ A: 0, B: 0 });
    });
  });

  describe('touch:voided', () => {
    it('marks the touch voided and recomputes the bout score excluding it', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 } }, { id: 'e1' }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'B', valid: true, scoreAfter: { A: 1, B: 1 } }, { id: 'e2' }));

      state = reducer(state, evt('touch:voided', { boutId: 'b1', targetEventId: 'e1', reason: 'mis-tap' }));

      const touches = state.touchesByBout.b1;
      expect(touches.find(t => t.eventId === 'e1')).toMatchObject({ voided: true, voidReason: 'mis-tap' });
      expect(touches.find(t => t.eventId === 'e2').voided).toBe(false);
      expect(state.bouts.b1.scoreAfter).toEqual({ A: 0, B: 1 });
    });

    it('recomputes each remaining touch\'s own scoreAfter, not just the bout total', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 } }, { id: 'e1' }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 2, B: 0 } }, { id: 'e2' }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'B', valid: true, scoreAfter: { A: 2, B: 1 } }, { id: 'e3' }));

      state = reducer(state, evt('touch:voided', { boutId: 'b1', targetEventId: 'e1' }));

      const touches = state.touchesByBout.b1;
      expect(touches.find(t => t.eventId === 'e2').scoreAfter).toEqual({ A: 1, B: 0 });
      expect(touches.find(t => t.eventId === 'e3').scoreAfter).toEqual({ A: 1, B: 1 });
    });

    it('an already-voided touch contributes nothing if voided again is a no-op on score', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', { boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 } }, { id: 'e1' }));
      state = reducer(state, evt('touch:voided', { boutId: 'b1', targetEventId: 'e1' }));
      state = reducer(state, evt('touch:voided', { boutId: 'b1', targetEventId: 'e1', reason: 'second call' }));

      expect(state.bouts.b1.scoreAfter).toEqual({ A: 0, B: 0 });
      expect(state.touchesByBout.b1[0].voided).toBe(true);
    });
  });

  describe('bout:completed', () => {
    it('sets status to complete without touching other fields', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('bout:completed', { boutId: 'b1' }));

      expect(state.bouts.b1.status).toBe('complete');
      expect(state.bouts.b1.weapon).toBe('foil');
    });
  });

  describe('bout:deleted', () => {
    it('soft-deletes the bout, keeping it in state rather than removing the key', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('bout:deleted', { targetId: 'b1', reason: 'test cleanup' }));

      expect(state.bouts.b1.deleted).toBe(true);
      expect(state.bouts.b1.weapon).toBe('foil');
    });
  });

  describe('card:issued', () => {
    it('increments the card count for the given side and card type', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'yellow' }, { id: 'e1' }));

      expect(state.bouts.b1.cardCounts.A).toEqual({ yellow: 1, red: 0, black: 0 });
      expect(state.bouts.b1.cardCounts.B).toEqual({ yellow: 0, red: 0, black: 0 });
      expect(state.officiatingByBout.b1).toEqual([
        { eventId: 'e1', id: 'e1', occurredAt: 1000, kind: 'card', boutId: 'b1', against: 'A', cardType: 'yellow' },
      ]);
    });

    it('accumulates multiple cards for the same side', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'yellow' }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'yellow' }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'red' }));

      expect(state.bouts.b1.cardCounts.A).toEqual({ yellow: 2, red: 1, black: 0 });
    });
  });

  // Anything another event may later point at carries its own id, supplied
  // in the payload. The store's event id can't serve on its own: it doesn't
  // exist at dispatch time, so an event can't use it to reference something
  // it creates in the same breath.
  describe('entity identity', () => {
    it('prefers a caller-supplied id over the event id', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', {
        boutId: 'b1', touchId: 't-77', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 },
      }, { id: 'evt-1' }));

      expect(state.touchesByBout.b1[0].id).toBe('t-77');
      expect(state.touchesByBout.b1[0].eventId).toBe('evt-1');
    });

    it('falls back to the event id so older records stay addressable', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('touch:scored', {
        boutId: 'b1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 },
      }, { id: 'evt-2' }));

      expect(state.touchesByBout.b1[0].id).toBe('evt-2');
    });

    it('voids by either identity', () => {
      const build = target => {
        let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
        state = reducer(state, evt('touch:scored', {
          boutId: 'b1', touchId: 't-9', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 },
        }, { id: 'evt-9' }));
        return reducer(state, evt('touch:voided', { boutId: 'b1', targetEventId: target }));
      };

      expect(build('t-9').touchesByBout.b1[0].voided).toBe(true);
      expect(build('evt-9').touchesByBout.b1[0].voided).toBe(true);
    });

    it('gives cards and timeouts their own ids too', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'red', cardId: 'c-1' }));
      state = reducer(state, evt('timeout:called', { boutId: 'b1', calledBy: 'B', timeoutId: 'to-1' }));

      expect(state.officiatingByBout.b1.map(e => e.id)).toEqual(['c-1', 'to-1']);
    });
  });

  describe('card:revoked', () => {
    it('decrements the count and records the withdrawal rather than erasing it', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'red' }));
      state = reducer(state, evt('card:revoked', { boutId: 'b1', against: 'A', cardType: 'red' }, { id: 'r1' }));

      expect(state.bouts.b1.cardCounts.A.red).toBe(0);
      // Append-only: both the giving and the withdrawal stay in the log.
      expect(state.officiatingByBout.b1.map(e => e.kind)).toEqual(['card', 'card-revoked']);
    });

    it('ignores a repeat withdrawal of the same card', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('card:issued', { boutId: 'b1', against: 'A', cardType: 'red', cardId: 'c-7' }));
      state = reducer(state, evt('card:revoked', { boutId: 'b1', against: 'A', cardType: 'red', targetCardId: 'c-7' }));
      state = reducer(state, evt('card:revoked', { boutId: 'b1', against: 'A', cardType: 'red', targetCardId: 'c-7' }));

      expect(state.bouts.b1.cardCounts.A.red).toBe(0);
      // And the log doesn't grow a second withdrawal for the same card.
      expect(state.officiatingByBout.b1.filter(e => e.kind === 'card-revoked')).toHaveLength(1);
    });

    it('never drives a count below zero', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('card:revoked', { boutId: 'b1', against: 'A', cardType: 'yellow' }));
      expect(state.bouts.b1.cardCounts.A.yellow).toBe(0);
    });
  });

  describe('timeout:called', () => {
    it('appends a timeout entry to the officiating log', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} }));
      state = reducer(state, evt('timeout:called', { boutId: 'b1', calledBy: 'B' }, { id: 'e1' }));

      expect(state.officiatingByBout.b1).toEqual([
        { eventId: 'e1', id: 'e1', occurredAt: 1000, kind: 'timeout', boutId: 'b1', calledBy: 'B' },
      ]);
    });
  });

  describe('priority:assigned', () => {
    it('sets the bout priority to the given side', () => {
      let state = reducer({}, evt('bout:created', { boutId: 'b1', weapon: 'epee', participants: {} }));
      state = reducer(state, evt('priority:assigned', { boutId: 'b1', side: 'A' }));

      expect(state.bouts.b1.priority).toBe('A');
    });
  });

  describe('unknown event types', () => {
    it('returns state unchanged', () => {
      const state = { bouts: { b1: { id: 'b1' } } };
      expect(reducer(state, evt('something:unrelated', {}))).toBe(state);
    });
  });
});
