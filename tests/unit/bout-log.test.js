// Pure: no store, no DOM, no mounted component. That is the point of having
// pulled this out of capture-page — the entries-to-markup transformation used
// to be reachable only through a mounted page, so its branches were covered
// incidentally or not at all (78.9% before this file).
//
// The pairing logic below is also where the worst bug in this project lived:
// withdrawing one red card struck the wrong rows, because a card and the point
// it awarded were matched on shape (side + type) rather than on a card id.
// These tests pin the identity rules that replaced that.
import { describe, it, expect } from 'vitest';
import { renderLogHtml } from '../../app/pages/capture/bout-log.js';

const touch = (over = {}) => ({
  kind: 'touch', eventId: `e${Math.random()}`, id: `t${Math.random()}`,
  scoredBy: 'A', valid: true, voided: false, occurredAt: 1,
  scoreAfter: { A: 1, B: 0 }, matchClockSeconds: 180, period: 1, ...over,
});
const card = (over = {}) => ({
  kind: 'card', eventId: `c${Math.random()}`, against: 'B', cardType: 'yellow',
  occurredAt: 2, matchClockSeconds: 170, period: 1, ...over,
});

const render = (touches, officiating = [], showPeriod = false) =>
  renderLogHtml(touches, officiating, { showPeriod });

describe('bout log rendering', () => {
  it('renders nothing for an empty bout', () => {
    const { html, entryCount } = render([], []);
    expect(entryCount).toBe(0);
    expect(html).toBe('');
  });

  it('puts the most recent act first — that is what a referee is checking', () => {
    const { html } = render([
      touch({ scoredBy: 'A', occurredAt: 1, scoreAfter: { A: 1, B: 0 } }),
      touch({ scoredBy: 'B', occurredAt: 2, scoreAfter: { A: 1, B: 1 } }),
    ]);
    expect(html.indexOf('1–1')).toBeLessThan(html.indexOf('1–0'));
  });

  it('marks a voided touch so it reads as struck through, not deleted', () => {
    const { html } = render([touch({ voided: true })]);
    expect(html).toContain('voided');
    expect(html).toContain('data-kind="touch"');
  });

  describe('a voided row shows no score at all', () => {
    // Decided after a real bout proved the alternative unreadable. Showing the
    // frozen score is truthful per row and nonsense per column: non-contiguous
    // voids freeze each struck row at a different moment, so the numbers are
    // ordered by when each touch was VOIDED while the rows are ordered by when
    // each HAPPENED. The live rows alone are a valid sequence.
    it('keeps who, drops the number', () => {
      const { html } = render([touch({ scoredBy: 'B', voided: true, scoreAfter: { A: 0, B: 1 } })]);

      expect(html).toContain('Red');
      expect(html).toContain('voided');
      expect(html).not.toMatch(/\d+–\d+/);
    });

    it('still shows the score on a live row', () => {
      const { html } = render([touch({ scoredBy: 'B', voided: false, scoreAfter: { A: 0, B: 1 } })]);
      expect(html).toContain('0–1');
    });

    it('drops it from a voided double too', () => {
      const { html } = render([
        touch({ pairId: 'p1', voided: true, scoreAfter: { A: 1, B: 1 }, occurredAt: 1 }),
        touch({ pairId: 'p1', voided: true, scoreAfter: { A: 1, B: 1 }, occurredAt: 1 }),
      ]);
      expect(html).toContain('Double');
      expect(html).not.toMatch(/\d+–\d+/);
    });

    it('drops it from a withdrawn red card and its point', () => {
      const { html } = render(
        [touch({ scoredBy: 'A', awardedByCardId: 'c1', occurredAt: 4, voided: true })],
        [card({ cardId: 'c1', cardType: 'red', against: 'B', occurredAt: 3 })],
      );
      expect(html).toContain('data-kind="card-point"');
      expect(html).not.toMatch(/\d+–\d+/);
    });

    it('renders the real bout that prompted this without a misleading tally', () => {
      // Nine touches, four voided out of chronological order, final board 3-2.
      // Reconstructed from a referee's report that the log could not be
      // explained — it was correct, and unreadable. Every surviving score here
      // must form a real sequence: 1-0, 2-0, 2-1, 2-2, 3-2.
      const at = n => ({ occurredAt: n, period: 1, matchClockSeconds: 180 - n });
      const T = (side, a, b, n, voided = false) =>
        touch({ scoredBy: side, scoreAfter: { A: a, B: b }, voided, eventId: `e${n}`, id: `t${n}`, ...at(n) });

      const { html } = render([
        T('A', 1, 0, 0), T('A', 2, 0, 1), T('B', 2, 1, 2), T('B', 2, 2, 3),
        T('A', 3, 2, 4),
        T('A', 4, 2, 5, true), T('B', 3, 3, 6, true),
        T('B', 4, 4, 7, true), T('B', 3, 4, 8, true),
      ]);

      const scores = [...html.matchAll(/(\d+)–(\d+)/g)].map(m => `${m[1]}-${m[2]}`);
      // Newest-first, and only the five live rows carry a number.
      expect(scores).toEqual(['3-2', '2-2', '2-1', '2-0', '1-0']);
    });
  });

  describe('a double is one row, not two', () => {
    it('collapses a pair sharing a pairId', () => {
      const { html, entryCount } = render([
        touch({ scoredBy: 'A', pairId: 'p1', scoreAfter: { A: 1, B: 1 }, occurredAt: 1 }),
        touch({ scoredBy: 'B', pairId: 'p1', scoreAfter: { A: 1, B: 1 }, occurredAt: 1 }),
      ]);
      expect(entryCount).toBe(1);
      expect(html).toContain('data-kind="double"');
      expect((html.match(/<li/g) ?? []).length).toBe(1);
    });

    it('carries both event ids, so voiding the row voids both touches', () => {
      const { html } = render([
        touch({ eventId: 'x1', pairId: 'p1', occurredAt: 1 }),
        touch({ eventId: 'x2', pairId: 'p1', occurredAt: 1 }),
      ]);
      expect(html).toMatch(/data-event-ids="x1 x2"|data-event-ids="x2 x1"/);
    });

    it('is struck through only when BOTH halves are voided', () => {
      const half = render([
        touch({ pairId: 'p1', voided: true, occurredAt: 1 }),
        touch({ pairId: 'p1', voided: false, occurredAt: 1 }),
      ]);
      expect(half.html).not.toContain('voided"');

      const both = render([
        touch({ pairId: 'p1', voided: true, occurredAt: 1 }),
        touch({ pairId: 'p1', voided: true, occurredAt: 1 }),
      ]);
      expect(both.html).toContain('voided');
    });
  });

  describe('a red card and the point it awards are one act', () => {
    // The card must be chronologically BEFORE its point. _issueCard awaits the
    // card's dispatch before dispatching the touch, and dispatch() stamps
    // Date.now() at call time, so the card is always strictly earlier in
    // practice. Pinned explicitly below, because an equal timestamp silently
    // produces two rows instead of one.
    it('pairs them into a single row', () => {
      const { html, entryCount } = render(
        [touch({ scoredBy: 'A', awardedByCardId: 'c1', occurredAt: 4 })],
        [card({ cardId: 'c1', cardType: 'red', against: 'B', occurredAt: 3 })],
      );
      expect(entryCount).toBe(1);
      expect(html).toContain('data-kind="card-point"');
      expect(html).toContain('data-card-id="c1"');
    });

    it('attaches each point to ITS OWN card when a fencer holds several reds', () => {
      // The original bug: matching on (side, cardType) linked the first card
      // to every point, so withdrawing one struck the wrong row.
      const { html, entryCount } = render(
        [
          touch({ scoredBy: 'A', awardedByCardId: 'c1', occurredAt: 4, scoreAfter: { A: 1, B: 0 } }),
          touch({ scoredBy: 'A', awardedByCardId: 'c2', occurredAt: 6, scoreAfter: { A: 2, B: 0 } }),
        ],
        [
          card({ cardId: 'c1', cardType: 'red', against: 'B', occurredAt: 3 }),
          card({ cardId: 'c2', cardType: 'red', against: 'B', occurredAt: 5 }),
        ],
      );
      expect(entryCount).toBe(2);
      expect(html).toContain('data-card-id="c1"');
      expect(html).toContain('data-card-id="c2"');
    });

    it('pairs regardless of which one sorts first', () => {
      // This test used to assert the OPPOSITE — that identical timestamps
      // produce two rows — on the reasoning that the app could not generate
      // them, since _issueCard awaits the card's dispatch before dispatching
      // the point. That reasoning was wrong, and the test was documenting a
      // live bug as acceptable behaviour.
      //
      // Date.now() has 1ms resolution. On a fast device the awaited IDB
      // round-trip finishes inside the same millisecond, both events get the
      // same occurredAt, Array.sort is stable, and the touch — spread before
      // officiating — sorts ahead of its own card. The loop pushed it as a
      // standalone row and the card then folded the same touch in again, so
      // the point appeared twice. CI on a fast runner caught it.
      const at = t => ({ occurredAt: t, period: 1, matchClockSeconds: 170 });
      const point = t => touch({ scoredBy: 'A', awardedByCardId: 'c1', eventId: 'tp', id: 'tp', ...at(t) });
      const red = t => card({ cardId: 'c1', cardType: 'red', against: 'B', ...at(t) });

      for (const [label, cardAt, pointAt] of [
        ['card first', 1000, 1001],
        ['same millisecond', 1000, 1000],
        ['point first', 1001, 1000],
      ]) {
        const { html, entryCount } = render([point(pointAt)], [red(cardAt)]);
        expect(entryCount, label).toBe(1);
        expect(html, label).toContain('data-kind="card-point"');
        expect((html.match(/<li/g) ?? []).length, label).toBe(1);
      }
    });

    it('still shows an ordinary touch that no card awarded', () => {
      // The skip must be narrow: only touches naming a card that exists get
      // absorbed. Everything else is its own row.
      const { html, entryCount } = render(
        [
          touch({ scoredBy: 'A', awardedByCardId: 'c1', occurredAt: 1000, eventId: 'tp' }),
          touch({ scoredBy: 'B', occurredAt: 2000, eventId: 'plain' }),
        ],
        [card({ cardId: 'c1', cardType: 'red', against: 'B', occurredAt: 1000 })],
      );
      expect(entryCount).toBe(2);
      expect(html).toContain('data-kind="card-point"');
      expect(html).toContain('data-event-id="plain"');
    });

    it('does not absorb a touch whose card is not in the log', () => {
      // An imported slice can carry a point whose card event never arrived.
      // Dropping it would lose data; it must render as a plain touch.
      const { html, entryCount } = render(
        [touch({ scoredBy: 'A', awardedByCardId: 'missing', occurredAt: 1000, eventId: 'orphan' })],
        [],
      );
      expect(entryCount).toBe(1);
      expect(html).toContain('data-event-id="orphan"');
    });

    it('does not pair a yellow, which awards no point', () => {
      const { html, entryCount } = render([], [card({ cardType: 'yellow', cardId: 'c1' })]);
      expect(entryCount).toBe(1);
      expect(html).toContain('data-kind="card"');
      expect(html).not.toContain('card-point');
    });

    it('folds a withdrawal into the card row rather than adding a second row', () => {
      const { html, entryCount } = render([], [
        card({ cardId: 'c1', cardType: 'red', occurredAt: 2 }),
        { kind: 'card-revoked', eventId: 'r1', targetCardId: 'c1', against: 'B', cardType: 'red', occurredAt: 4, period: 1 },
      ]);
      expect(entryCount).toBe(1);
      expect(html).toContain('voided');
    });
  });

  describe('officiating rows', () => {
    it('renders a timeout', () => {
      const { html } = render([], [{ kind: 'timeout', eventId: 'o1', calledBy: 'A', occurredAt: 1, period: 1 }]);
      expect(html).toContain('officiating');
    });

    it('falls back to showing an unrecognised kind rather than a blank row', () => {
      // Forward compatibility: a log slice from a newer app may carry an
      // officiating kind this version does not know. Showing it tells the
      // referee something happened; a blank row tells them nothing.
      const { html } = render([], [{ kind: 'future:thing', eventId: 'o2', occurredAt: 1, period: 1 }]);
      expect(html).toContain('future:thing');
    });
  });

  describe('period dividers', () => {
    it('adds none when the bout has a single period', () => {
      const { html } = render([touch({ period: 1 })], [], false);
      expect(html).not.toContain('log-divider');
    });

    it('heads each period group when there is more than one', () => {
      const { html } = render([
        touch({ period: 1, occurredAt: 1 }),
        touch({ period: 2, occurredAt: 2 }),
      ], [], true);
      expect((html.match(/log-divider/g) ?? []).length).toBe(2);
    });

    it('does not repeat a divider within one period', () => {
      const { html } = render([
        touch({ period: 2, occurredAt: 1 }),
        touch({ period: 2, occurredAt: 2 }),
      ], [], true);
      expect((html.match(/log-divider/g) ?? []).length).toBe(1);
    });
  });

  it('escapes values that came from an imported file', () => {
    // Event ids and participant data are untrusted on import.
    const { html } = render([touch({ eventId: '"><img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;');
  });
});
