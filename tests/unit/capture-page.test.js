// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, reset, dispatch, getState, getAllEvents } from '../../_lib/core/store/store.js';
import { reducer } from '../../app/store/reducer.js';
import '../../_lib/core/app-element.js';
import '../../_lib/modules/app-header/app-header.js';
import '../../_lib/modules/modal-dialog/modal-dialog.js';
import '../../app/pages/capture-page.js';

HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};

let dbSeq = 0;
function freshName() { return `test-capture-page-${dbSeq++}`; }

// fake-indexeddb resolves dispatch()'s underlying put() on a real task, not
// just a microtask — a bare `await Promise.resolve()` isn't enough to
// observe post-dispatch state after a synchronous DOM interaction (click,
// synthesized pointer events) whose handler doesn't await dispatch itself.
const flush = () => new Promise(r => setTimeout(r, 0));

const pdown = (el, x = 0, y = 0) => el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
const pmove = (el, x, y) => el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
const pup = (el, x = 0, y = 0) => el.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));

async function tap(el) { pdown(el); pup(el); await flush(); }
async function swipeLeft(el) { pdown(el, 100, 0); pmove(el, 50, 2); pup(el, 50, 2); await flush(); }
async function click(el) { el.click(); await flush(); }

// Scoring is deliberately a hold, not a tap — the clock owns the tap. The
// long-press fires off a timer, so fake timers are needed to cross the
// threshold, then handed back so the IDB write can actually settle.
//
// Two flushes, not one: the chain is long-press -> custom event -> page
// handler -> dispatch() -> fake-indexeddb put -> reducer -> subscriber,
// and fake-indexeddb resolves on a real task. A single macrotask was
// *usually* enough, which made this intermittently fail rather than fail
// honestly.
// Waits for the event log to stop growing, rather than for a fixed delay.
//
// This replaced `await flush(); await flush();` — two setTimeout(0) hops —
// which was the cause of this file's intermittent failures: full-suite only,
// never in isolation, with long clean streaks in between. The long-press
// handler calls dispatch() fire-and-forget, fake-indexeddb resolves put() on a
// real task, and under full-suite worker contention that task can land after
// any fixed number of macrotasks. A guessed duration is a race by construction.
//
// Two consecutive reads of the same length mean nothing is in flight. Each read
// is itself an IDB round-trip, so it yields to any pending transaction rather
// than racing it — and a gesture that writes nothing settles just as cleanly as
// one that writes two events (DOUBLE dispatches sequentially).
async function settleStore() {
  let last = -1;
  for (let i = 0; i < 400; i += 1) {
    const n = (await getAllEvents()).length;
    if (n === last) return;
    last = n;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('settleStore: event log never stopped growing');
}

async function hold(el) {
  vi.useFakeTimers();
  pdown(el);
  vi.advanceTimersByTime(600);
  vi.useRealTimers();
  pup(el);
  await settleStore();
}

// Retries until the assertions hold. The IDB write, reducer run and DOM update
// a gesture kicks off all land asynchronously, so the postcondition is what we
// can wait on — never a duration. CLAUDE.md's documented pattern.
const settled = fn => vi.waitFor(fn, { timeout: 2000, interval: 5 });

// Cards carry their own id so a point or a withdrawal can name the exact
// one — matching on (side, cardType) is ambiguous once a fencer holds two.
function cardIdAt(el, index) {
  return (el._officiating ?? []).filter(e => e.kind === 'card')[index]?.cardId;
}

async function mountFor(boutId) {
  const el = document.createElement('capture-page');
  el.params = { id: boutId };
  document.body.appendChild(el);
  await flush();
  return el;
}

describe('capture-page', () => {
  beforeEach(async () => {
    reset();
    // Sound prefs persist to localStorage by design (device setting, not
    // bout data), so they leak between tests unless cleared.
    localStorage.clear();
    await boot({ dbName: freshName(), reducer });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('with the default (Referee/Basic) preset', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'b1', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } } });
      el = await mountFor('b1');
    });

    const tapA = () => el.shadowRoot.querySelector('#tap-a');
    const tapB = () => el.shadowRoot.querySelector('#tap-b');

    it('renders each fencer name and score on their own half', () => {
      // touch-target renders into its own shadow root — the attributes are
      // the public contract.
      expect(tapA().getAttribute('label')).toBe('Alice');
      expect(tapB().getAttribute('label')).toBe('Bob');
      expect(tapA().getAttribute('score')).toBe('0');
      expect(tapB().getAttribute('score')).toBe('0');
    });

    it('holding a half logs a valid touch and updates that half\'s score', async () => {
      await hold(tapA());

      await settled(() => {
        expect(getState().touchesByBout.b1).toHaveLength(1);
        expect(getState().touchesByBout.b1[0]).toMatchObject({ scoredBy: 'A', valid: true });
        expect(tapA().getAttribute('score')).toBe('1');
      });
      expect(tapB().getAttribute('score')).toBe('0');
    });

    it('a plain tap on a half scores nothing — stray contact must not log a touch', async () => {
      await tap(tapA());
      expect(getState().touchesByBout?.b1).toBeUndefined();
      expect(tapA().getAttribute('score')).toBe('0');
    });

    it('a plain tap on a half halts a running clock — every surface can stop it', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      timer.start();

      await tap(tapA());

      expect(timer.running).toBe(false);
      expect(getState().touchesByBout?.b1).toBeUndefined(); // halted, not scored
      // Halting is all it does — the card picker must not also appear.
      expect(el.shadowRoot.querySelector('#card-picker').hasAttribute('open')).toBe(false);
    });

    it('a tap on the score area never opens cards — the halves are too big to aim', async () => {
      const picker = el.shadowRoot.querySelector('#card-picker');
      expect(el.shadowRoot.querySelector('#match-timer').running).toBe(false);

      await tap(tapB());

      // Only the rack opens cards; a mis-tap on a half must stay harmless.
      expect(picker.hasAttribute('open')).toBe(false);
      expect(getState().touchesByBout?.b1).toBeUndefined();
    });

    it('scoring still takes a hold, even with the clock halted', async () => {
      await hold(tapA());

      await settled(() => expect(getState().bouts.b1.scoreAfter).toEqual({ A: 1, B: 0 }));
      expect(el.shadowRoot.querySelector('#card-picker').hasAttribute('open')).toBe(false);
    });

    it('a tap that halts the clock pulses briefly; scoring pulses longer', async () => {
      const vibrate = vi.fn();
      vi.stubGlobal('navigator', { ...navigator, vibrate });

      el.shadowRoot.querySelector('#match-timer').start();
      await tap(tapA());
      expect(vibrate).toHaveBeenCalledWith(30);

      vibrate.mockClear();
      await hold(tapB());
      await settled(() => expect(vibrate).toHaveBeenCalledWith(120));

      vi.unstubAllGlobals();
    });

    it('floods every surface while the clock runs, and drains them when it stops', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      const flooded = () => ['#tap-a', '#tap-b', '#double-btn']
        .map(s => el.shadowRoot.querySelector(s).hasAttribute('running'));

      expect(flooded()).toEqual([false, false, false]);
      expect(el.shadowRoot.querySelector('main').hasAttribute('data-running')).toBe(false);

      timer.start();
      expect(flooded()).toEqual([true, true, true]);
      expect(el.shadowRoot.querySelector('main').hasAttribute('data-running')).toBe(true);
      expect(timer.hasAttribute('data-running')).toBe(true);

      timer.halt();
      expect(flooded()).toEqual([false, false, false]);
      expect(el.shadowRoot.querySelector('main').hasAttribute('data-running')).toBe(false);
    });

    it('scoring drains the flood, since scoring halts the clock', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      timer.start();

      await hold(tapA());

      await settled(() => {
        expect(el.shadowRoot.querySelector('#tap-a').hasAttribute('running')).toBe(false);
        expect(el.shadowRoot.querySelector('main').hasAttribute('data-running')).toBe(false);
      });
    });

    it('tapping a half never resumes the clock — only the clock band starts it', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      expect(timer.running).toBe(false);

      await tap(tapA());
      await tap(tapB());

      expect(timer.running).toBe(false);
    });

    it('scoring halts a running clock, in the same motion', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      timer.start();
      expect(timer.running).toBe(true);

      await hold(tapB());

      await settled(() => {
        expect(timer.running).toBe(false);
        expect(getState().bouts.b1.scoreAfter).toEqual({ A: 0, B: 1 });
      });
    });

    it('stamps each touch with the match clock and period it happened in', async () => {
      await hold(tapA());
      await settled(() => expect(getState().touchesByBout.b1[0]).toMatchObject({ matchClockSeconds: 180, period: 1 }));
    });

    it('hides the DOUBLE control for foil', () => {
      expect(el.shadowRoot.querySelector('#double-btn').hidden).toBe(true);
    });

    it('reflects issued cards on that fencer\'s own rack', async () => {
      await dispatch('card:issued', { boutId: 'b1', against: 'A', cardType: 'yellow' });
      await flush();
      expect(el.shadowRoot.querySelector('#rack-a').getAttribute('cards')).toBe('1,0,0');
      expect(el.shadowRoot.querySelector('#rack-b').getAttribute('cards')).toBe('0,0,0');
    });
  });

  describe('the clock survives leaving and coming back', () => {
    const FORMAT = { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 };

    const remount = async boutId => {
      document.body.innerHTML = '';
      return mountFor(boutId);
    };

    it('comes back where it was left, not reset to full', async () => {
      await dispatch('bout:created', { boutId: 'bc1', weapon: 'foil', participants: {}, format: FORMAT });
      const el = await mountFor('bc1');
      // A halt is what persists the reading.
      el.shadowRoot.querySelector('#match-timer').start();
      await flush();
      await dispatch('clock:updated', { boutId: 'bc1', period: 2, remainingSeconds: 95, running: false });
      await flush();

      const again = await remount('bc1');

      const timer = again.shadowRoot.querySelector('#match-timer');
      expect(timer.remainingSeconds).toBe(95);
      expect(timer.currentPeriod).toBe(2);
      expect(timer.running).toBe(false);
    });

    it('persists on halt, so an accidental reload costs nothing', async () => {
      await dispatch('bout:created', { boutId: 'bc2', weapon: 'foil', participants: {}, format: FORMAT });
      const el = await mountFor('bc2');
      const timer = el.shadowRoot.querySelector('#match-timer');

      timer.start();
      await flush();
      timer.halt();
      await flush();

      expect(getState().clockByBout.bc2).toMatchObject({ period: 1, running: false });
    });

    it('always returns halted, so it never drains unattended', async () => {
      await dispatch('bout:created', { boutId: 'bc3', weapon: 'foil', participants: {}, format: FORMAT });
      await dispatch('clock:updated', { boutId: 'bc3', period: 1, remainingSeconds: 120, running: true });
      await flush();

      const el = await mountFor('bc3');

      expect(el.shadowRoot.querySelector('#match-timer').running).toBe(false);
    });

    it('ignores a stale running clock rather than zeroing it', async () => {
      await dispatch('bout:created', { boutId: 'bc4', weapon: 'foil', participants: {}, format: FORMAT });
      // Left running a day ago: the bout was abandoned, not refereed, so
      // the last known-good reading is kept rather than drained to 0:00.
      await dispatch('clock:updated',
        { boutId: 'bc4', period: 1, remainingSeconds: 120, running: true },
        Date.now() - 86_400_000);
      await flush();

      const el = await mountFor('bc4');

      expect(el.shadowRoot.querySelector('#match-timer').remainingSeconds).toBe(120);
    });

    it('a fresh bout starts at the full period', async () => {
      await dispatch('bout:created', { boutId: 'bc5', weapon: 'foil', participants: {}, format: FORMAT });
      const el = await mountFor('bc5');
      expect(el.shadowRoot.querySelector('#match-timer').remainingSeconds).toBe(180);
    });
  });

  describe('the bout log deck', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bd', weapon: 'foil', participants: {} });
      el = await mountFor('bd');
    });

    const main = () => el.shadowRoot.querySelector('main');
    const handle = () => el.shadowRoot.querySelector('#deck-handle');
    const drag = (dy) => {
      handle().dispatchEvent(new PointerEvent('pointerdown', { clientY: 200, bubbles: true }));
      handle().dispatchEvent(new PointerEvent('pointerup', { clientY: 200 + dy, bubbles: true }));
    };

    it('starts collapsed, with the log out of the way', () => {
      expect(main().hasAttribute('data-expanded')).toBe(false);
      expect(handle().getAttribute('aria-expanded')).toBe('false');
    });

    it('dragging up opens it, dragging down closes it', () => {
      drag(-80);
      expect(main().hasAttribute('data-expanded')).toBe(true);
      expect(handle().getAttribute('aria-expanded')).toBe('true');

      drag(80);
      expect(main().hasAttribute('data-expanded')).toBe(false);
    });

    it('a short drag is treated as a tap and toggles', () => {
      drag(-5);                       // under the threshold — falls through
      handle().click();
      expect(main().hasAttribute('data-expanded')).toBe(true);
    });

    it('opens while the clock is running — reading the log never requires a halt', () => {
      el.shadowRoot.querySelector('#match-timer').start();
      drag(-80);
      expect(main().hasAttribute('data-expanded')).toBe(true);
    });

    it('stays open when the clock is started from within it', () => {
      drag(-80);
      expect(main().hasAttribute('data-expanded')).toBe(true);

      el.shadowRoot.querySelector('#match-timer').start();

      // Being thrown out of the log to restart the bout would be worse
      // than any tidiness it buys.
      expect(main().hasAttribute('data-expanded')).toBe(true);
    });

    it('the clock stays a control while open — tapping the band toggles it', () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      drag(-80);

      tap(timer);
      expect(timer.running).toBe(true);
      expect(main().hasAttribute('data-expanded')).toBe(true);

      tap(timer);
      expect(timer.running).toBe(false);
      expect(main().hasAttribute('data-expanded')).toBe(true);
    });

    it('still allows period changes and ending the bout while open', async () => {
      await dispatch('bout:created', { boutId: 'bd2', weapon: 'foil', participants: {}, format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 } });
      document.body.innerHTML = '';
      const el2 = await mountFor('bd2');
      const h = el2.shadowRoot.querySelector('#deck-handle');
      h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 200, bubbles: true }));
      h.dispatchEvent(new PointerEvent('pointerup', { clientY: 120, bubbles: true }));

      await click(el2.shadowRoot.querySelector('#next-period-btn'));
      expect(el2.shadowRoot.querySelector('#match-timer').currentPeriod).toBe(2);

      await click(el2.shadowRoot.querySelector('#complete-btn'));
      expect(el2.shadowRoot.querySelector('#complete-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(true);
    });

    it('holds the log, which is no longer in the actions sheet', async () => {
      await hold(el.shadowRoot.querySelector('#tap-a'));

      const rows = [...el.shadowRoot.querySelectorAll('#log-pane .log-row')];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent.replace(/\s+/g, ' ').trim()).toBe('Green — 1–0 P1 3:00');
    });
  });

  // Reported in use: with several reds, withdrawing one struck the wrong
  // rows — sometimes every row, sometimes the two that were still live.
  // The cause was no card identity: the log matched revocations on
  // (side, cardType), which is ambiguous the moment a fencer holds two.
  describe('withdrawing one card of several', () => {
    let el;

    const giveCard = async (side, type) => {
      el.shadowRoot.querySelector(`#rack-${side}`).shadowRoot.querySelector('#btn').click();
      await flush();
      const picker = el.shadowRoot.querySelector('#card-picker');
      picker._index = picker._options.indexOf(type);
      picker._syncCurrent();
      picker.shadowRoot.querySelector('#apply').click();
      await flush();
      await flush();
    };

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bmc', weapon: 'foil', participants: {} });
      el = await mountFor('bmc');
    });

    it('strikes only the withdrawn one, with three reds on the same fencer', async () => {
      await giveCard('a', 'red');
      await giveCard('a', 'red');
      await giveCard('a', 'red');
      expect(getState().bouts.bmc.scoreAfter).toEqual({ A: 0, B: 3 });

      const ids = [0, 1, 2].map(i => cardIdAt(el, i));

      // Withdraw the middle one specifically.
      await el._revokeCard(ids[1]);
      await settleStore();

      // Names the row that must be struck and the two that must not, rather
      // than counting. This is the regression test for the original bug —
      // withdrawing one red struck whichever row came first — so "exactly one
      // is struck" was always the wrong assertion: it passes even when the
      // WRONG row is the struck one. It is also count-brittle mid-flight,
      // which is how its sibling came to fail in CI.
      await settled(() => {
        const voided = id => el.shadowRoot
          .querySelector(`.log-row[data-card-id="${id}"]`)?.classList.contains('voided');
        expect(voided(ids[1])).toBe(true);
        expect(voided(ids[0])).toBe(false);
        expect(voided(ids[2])).toBe(false);
        expect(getState().bouts.bmc.cardCounts.A.red).toBe(2);
        expect(getState().bouts.bmc.scoreAfter).toEqual({ A: 0, B: 2 });
      });
    });

    it('voids that card\'s own point, not the most recent one', async () => {
      await giveCard('a', 'red');
      await giveCard('a', 'red');

      const firstCardId = cardIdAt(el, 0);
      await el._revokeCard(firstCardId);
      await flush();
      await flush();

      const voided = getState().touchesByBout.bmc.filter(t => t.voided);
      expect(voided).toHaveLength(1);
      expect(voided[0].awardedByCardId).toBe(firstCardId);
    });

    it('withdrawing the same card twice does not double-decrement', async () => {
      await giveCard('a', 'red');
      const id = cardIdAt(el, 0);

      await el._revokeCard(id);
      await flush();
      await el._revokeCard(id);
      await flush();

      expect(getState().bouts.bmc.cardCounts.A.red).toBe(0);
      expect(getState().bouts.bmc.scoreAfter).toEqual({ A: 0, B: 0 });
    });

    it('yellow and black can be withdrawn too, by swiping their row', async () => {
      await giveCard('a', 'yellow');
      expect(getState().bouts.bmc.cardCounts.A.yellow).toBe(1);

      await swipeLeft(el.shadowRoot.querySelector('.log-row'));
      await click(el.shadowRoot.querySelector('#void-confirm-btn'));
      await settleStore();

      await settled(() => {
        expect(getState().bouts.bmc.cardCounts.A.yellow).toBe(0);
        // Assert it stayed ONE row, which is what the withdrawal folding is
        // for, rather than counting how many are struck.
        const rows = [...el.shadowRoot.querySelectorAll('.log-row')];
        expect(rows).toHaveLength(1);
        expect(rows[0].classList.contains('voided')).toBe(true);
      });
    });

    it('keeps cards against different fencers independent', async () => {
      await giveCard('a', 'red');
      await giveCard('b', 'red');
      const revoked = cardIdAt(el, 0);
      const kept = cardIdAt(el, 1);

      await el._revokeCard(revoked);
      await settleStore();

      // Asserts WHICH row is struck, not how many are. The count form failed
      // in CI with [true, true] and could not say why: _revokeCard dispatches
      // two events in sequence (card:revoked then touch:voided), and between
      // the renders there is a window where the revocation has not yet folded
      // into its card row and shows as its own struck officiating row. Two
      // struck rows, both legitimate mid-flight, and a count cannot tell that
      // from the bug it was meant to catch.
      await settled(() => {
        expect(getState().bouts.bmc.cardCounts.A.red).toBe(0);
        expect(getState().bouts.bmc.cardCounts.B.red).toBe(1);

        const rowFor = id => el.shadowRoot.querySelector(`.log-row[data-card-id="${id}"]`);
        expect(rowFor(revoked)?.classList.contains('voided')).toBe(true);
        expect(rowFor(kept)?.classList.contains('voided')).toBe(false);
      });
    });
  });

  describe('a withdrawn card stays one entry', () => {
    it('shows a single struck-through row, not the card and its undo', async () => {
      await dispatch('bout:created', { boutId: 'bw', weapon: 'foil', participants: {} });
      const el = await mountFor('bw');

      el.shadowRoot.querySelector('#rack-a').shadowRoot.querySelector('#btn').click();
      await flush();
      const picker = el.shadowRoot.querySelector('#card-picker');
      picker._index = picker._options.indexOf('red');
      picker._syncCurrent();
      picker.shadowRoot.querySelector('#apply').click();
      await flush();
      await flush();

      await el._revokeCard(cardIdAt(el, 0));
      await flush();
      await flush();

      const rows = [...el.shadowRoot.querySelectorAll('.log-row')];
      // The user only ever saw one row; undoing it must not split it in two.
      expect(rows).toHaveLength(1);
      expect(rows[0].classList.contains('voided')).toBe(true);
    });
  });

  describe('a red card and its point read as one entry', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bj', weapon: 'foil', participants: {} });
      el = await mountFor('bj');
    });

    const rows = () => [...el.shadowRoot.querySelectorAll('.log-row')]
      .map(r => ({ kind: r.dataset.kind, text: r.textContent.replace(/\s+/g, ' ').trim() }));
    const giveRed = async side => {
      el.shadowRoot.querySelector(`#rack-${side}`).shadowRoot.querySelector('#btn').click();
      await flush();
      const picker = el.shadowRoot.querySelector('#card-picker');
      picker._index = picker._options.indexOf('red');
      picker._syncCurrent();
      picker.shadowRoot.querySelector('#apply').click();
      await flush();
      await flush();
    };

    it('collapses the card and the point it awarded into a single row', async () => {
      await giveRed('a');

      // Two events were dispatched, but they are one act.
      expect(getState().officiatingByBout.bj).toHaveLength(1);
      expect(getState().touchesByBout.bj).toHaveLength(1);
      // Score first, reason second — and the stripe follows the fencer who
      // gained the point, not the one penalised.
      expect(rows()).toEqual([
        { kind: 'card-point', text: 'Red — 0–1 🟥 red card for Green P1 3:00' },
      ]);
      expect(el.shadowRoot.querySelector('.log-row').dataset.side).toBe('B');
    });

    it('leaves ordinary touches as their own rows', async () => {
      await giveRed('b');
      // Timestamped explicitly: hold() runs under fake timers and advances
      // the clock 600ms, which would otherwise place its touch *after*
      // real-time events dispatched later.
      await dispatch('touch:scored', {
        boutId: 'bj', scoredBy: 'A', valid: true, scoreAfter: { A: 2, B: 0 },
      }, Date.now() + 1000);
      await flush();

      expect(rows().map(r => r.kind)).toEqual(['touch', 'card-point']);
    });

    it('undoing the joined row takes back both the card and the point', async () => {
      await giveRed('a');
      expect(getState().bouts.bj.scoreAfter).toEqual({ A: 0, B: 1 });

      await swipeLeft(el.shadowRoot.querySelector('.log-row'));
      await click(el.shadowRoot.querySelector('#void-confirm-btn'));
      await flush();

      expect(getState().bouts.bj.cardCounts.A.red).toBe(0);
      expect(getState().bouts.bj.scoreAfter).toEqual({ A: 0, B: 0 });
    });

    it('asks about the card, not the touch, when undoing a joined row', async () => {
      await giveRed('a');
      await swipeLeft(el.shadowRoot.querySelector('.log-row'));

      expect(el.shadowRoot.querySelector('#void-confirm-prompt').textContent)
        .toBe('Withdraw this red card? The point it awarded goes back too.');
    });
  });

  // Ordering matters beyond tidiness: every logged act is stamped with the
  // clock reading taken at the moment it is recorded, so if an action ran
  // before the halt the stamp would be a still-ticking value and the log
  // would disagree with what the referee saw. These pin the order.
  describe('the clock is halted before the action, never after', () => {
    let el;
    let timer;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bord', weapon: 'epee', participants: {} });
      el = await mountFor('bord');
      timer = el.shadowRoot.querySelector('#match-timer');
    });

    it('scoring: the clock is already stopped when the touch is recorded', async () => {
      const runningWhenLogged = [];
      const original = el._logTouch.bind(el);
      el._logTouch = side => { runningWhenLogged.push(timer.running); return original(side); };

      timer.start();
      await hold(el.shadowRoot.querySelector('#tap-a'));

      expect(runningWhenLogged).toEqual([false]);
    });

    it('double: both halves are recorded against a stopped clock', async () => {
      const seen = [];
      const original = el._clockStamp.bind(el);
      el._clockStamp = () => { seen.push(timer.running); return original(); };

      timer.start();
      await hold(el.shadowRoot.querySelector('#double-btn'));
      await flush();

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(running => running === false)).toBe(true);
    });

    it('cards: the clock is stopped before the picker is even offered', async () => {
      timer.start();

      el.shadowRoot.querySelector('#rack-a').shadowRoot.querySelector('#btn').click();
      await flush();

      expect(timer.running).toBe(false);
      expect(el.shadowRoot.querySelector('#card-picker').hasAttribute('open')).toBe(true);
    });

    it('the stamp records the halted reading, not a ticking one', async () => {
      timer.start();
      const atHalt = Math.round(timer.remainingSeconds);

      await hold(el.shadowRoot.querySelector('#tap-a'));

      // Identical because the clock stopped first; a late halt would let
      // this drift by however long the dispatch took.
      expect(getState().touchesByBout.bord[0].matchClockSeconds).toBe(atHalt);
      expect(timer.running).toBe(false);
    });
  });

  describe('what the running clock blocks', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'brun', weapon: 'foil', participants: {}, format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 } });
      el = await mountFor('brun');
      await hold(el.shadowRoot.querySelector('#tap-a'));
      el.shadowRoot.querySelector('#deck-handle').click();     // open the log
    });

    const timer = () => el.shadowRoot.querySelector('#match-timer');

    it('floods the log with the running colour, so a running clock is never hidden', () => {
      timer().start();
      expect(el.shadowRoot.querySelector('main').hasAttribute('data-running')).toBe(true);
    });

    it('a press in the log stops the clock instead of acting', async () => {
      timer().start();
      const row = el.shadowRoot.querySelector('.log-row');

      await tap(row);

      expect(timer().running).toBe(false);
      // The press was swallowed — no void prompt appeared.
      expect(el.shadowRoot.querySelector('#void-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(false);
    });

    it('scrolling the log leaves the clock alone', async () => {
      timer().start();
      const pane = el.shadowRoot.querySelector('#log-pane');

      // A drag is a scroll, not a press — reading back earlier touches
      // must not cost the referee their clock.
      pdown(pane, 100, 300);
      pmove(pane, 102, 210);
      pup(pane, 102, 210);
      await flush();

      expect(timer().running).toBe(true);
      expect(el.shadowRoot.querySelector('#void-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(false);
    });

    it('a swipe to void is still blocked while running', async () => {
      timer().start();

      await swipeLeft(el.shadowRoot.querySelector('.log-row'));

      // Swallowed either way: the row never sees it.
      expect(el.shadowRoot.querySelector('#void-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(false);
    });

    it('blocks the deck buttons too while running', async () => {
      timer().start();

      await click(el.shadowRoot.querySelector('#complete-btn'));

      expect(timer().running).toBe(false);
      expect(el.shadowRoot.querySelector('#complete-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(false);
    });

    it('the period button only halts while running, then works', async () => {
      el.shadowRoot.querySelector('#deck-handle').click(); // close the log
      timer().start();

      await click(el.shadowRoot.querySelector('#next-period-btn'));
      expect(timer().running).toBe(false);
      expect(timer().currentPeriod).toBe(1);   // halted, not advanced

      await click(el.shadowRoot.querySelector('#next-period-btn'));
      expect(timer().currentPeriod).toBe(2);
    });

    it('the End Bout icon only halts while running, then asks', async () => {
      el.shadowRoot.querySelector('#deck-handle').click(); // close the log
      timer().start();
      const icon = el.shadowRoot.querySelector('#complete-icon-btn');

      await click(icon);
      expect(timer().running).toBe(false);
      expect(el.shadowRoot.querySelector('#complete-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(false);

      await click(icon);
      expect(el.shadowRoot.querySelector('#complete-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(true);
    });

    it('everything works normally once the clock is stopped', async () => {
      timer().start();
      await click(el.shadowRoot.querySelector('#complete-btn'));  // first click only halts
      await click(el.shadowRoot.querySelector('#complete-btn'));  // second acts

      expect(el.shadowRoot.querySelector('#complete-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(true);
    });

    it('leaves the log scrollable while running', () => {
      timer().start();
      const pane = el.shadowRoot.querySelector('#log-pane');
      // Scrolling is browser-native on the pane and never intercepted.
      expect(getComputedStyle(pane).overflowY).toBe('auto');
      expect(timer().running).toBe(true);
    });
  });

  describe('when each act happened', () => {
    it('stamps the clock reading the referee saw, and renders it mm:ss', async () => {
      await dispatch('bout:created', { boutId: 'bts', weapon: 'foil', participants: {}, format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 } });
      const el = await mountFor('bts');
      const timer = el.shadowRoot.querySelector('#match-timer');

      await hold(el.shadowRoot.querySelector('#tap-a'));

      const touch = getState().touchesByBout.bts[0];
      expect(touch.period).toBe(timer.currentPeriod);
      expect(touch.matchClockSeconds).toBe(Math.round(timer.remainingSeconds));
      expect(el.shadowRoot.querySelector('.log-row .at').textContent).toBe('P1 3:00');
    });

    it('omits the period in a single-period bout, where the clock never restarts', async () => {
      await dispatch('bout:created', {
        boutId: 'bts1p', weapon: 'foil', participants: {},
        format: { targetScore: 5, periodLengthSeconds: 180, periodCount: 1 },
      });
      const el = await mountFor('bts1p');

      await hold(el.shadowRoot.querySelector('#tap-a'));

      expect(el.shadowRoot.querySelector('.log-row .at').textContent).toBe('3:00');
    });

    it('marks which period an act belongs to when there is more than one', async () => {
      await dispatch('bout:created', {
        boutId: 'bts3p', weapon: 'foil', participants: {},
        format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 },
      });
      const el = await mountFor('bts3p');
      // "2:35" alone appears once per period and says nothing about which.
      await dispatch('touch:scored', {
        boutId: 'bts3p', touchId: 'tp', scoredBy: 'A', valid: true,
        scoreAfter: { A: 1, B: 0 }, matchClockSeconds: 155, period: 2,
      });
      await flush();

      expect(el.shadowRoot.querySelector('.log-row .at').textContent).toBe('P2 2:35');
    });

    it('renders a part-way clock reading rather than only round minutes', async () => {
      await dispatch('bout:created', { boutId: 'bts3', weapon: 'foil', participants: {} });
      const el = await mountFor('bts3');
      // Inject a stamped touch directly — driving the real interval under
      // swapped-in fake timers does not work (it was registered against the
      // real clock at mount).
      await dispatch('touch:scored', {
        boutId: 'bts3', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 },
        matchClockSeconds: 155, period: 1,
      });
      await flush();

      expect(el.shadowRoot.querySelector('.log-row .at').textContent).toBe('P1 2:35');
    });

    it('stamps cards too, so every row can be placed on the clock', async () => {
      await dispatch('bout:created', { boutId: 'bts2', weapon: 'foil', participants: {} });
      const el = await mountFor('bts2');

      el.shadowRoot.querySelector('#rack-a').shadowRoot.querySelector('#btn').click();
      await flush();
      el.shadowRoot.querySelector('#card-picker').shadowRoot.querySelector('#apply').click();
      await flush();

      expect(getState().officiatingByBout.bts2[0]).toMatchObject({ matchClockSeconds: 180, period: 1 });
    });
  });

  describe('period dividers in the log', () => {
    const rowsAndDividers = el => [...el.shadowRoot.querySelectorAll('#touch-log > li')]
      .map(li => (li.classList.contains('log-divider') ? `— ${li.textContent} —` : li.querySelector('.who').textContent));

    it('heads each period\'s group, derived from the entries alone', async () => {
      await dispatch('bout:created', {
        boutId: 'bdiv', weapon: 'foil', participants: {},
        format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 },
      });
      const el = await mountFor('bdiv');

      const add = (touchId, scoredBy, score, period) => dispatch('touch:scored', {
        boutId: 'bdiv', touchId, scoredBy, valid: true, scoreAfter: score,
        matchClockSeconds: 120, period,
      });
      await add('t1', 'A', { A: 1, B: 0 }, 1);
      await add('t2', 'B', { A: 1, B: 1 }, 2);
      await add('t3', 'A', { A: 2, B: 1 }, 2);
      await flush();

      // Newest-first, so each heading sits above its own group.
      expect(rowsAndDividers(el)).toEqual([
        '— Period 2 —',
        'Green — 2–1',
        'Red — 1–1',
        '— Period 1 —',
        'Green — 1–0',
      ]);
    });

    it('adds no dividers to a single-period bout', async () => {
      await dispatch('bout:created', {
        boutId: 'bdiv1', weapon: 'foil', participants: {},
        format: { targetScore: 5, periodLengthSeconds: 180, periodCount: 1 },
      });
      const el = await mountFor('bdiv1');
      await hold(el.shadowRoot.querySelector('#tap-a'));

      expect(el.shadowRoot.querySelectorAll('.log-divider')).toHaveLength(0);
    });

    it('leaves dividers out of the swipe-to-void handling', async () => {
      await dispatch('bout:created', {
        boutId: 'bdiv2', weapon: 'foil', participants: {},
        format: { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 },
      });
      const el = await mountFor('bdiv2');
      await hold(el.shadowRoot.querySelector('#tap-a'));

      const divider = el.shadowRoot.querySelector('.log-divider');
      expect(divider).not.toBeNull();
      await swipeLeft(divider);

      expect(el.shadowRoot.querySelector('#void-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(false);
    });
  });

  describe('offering the end of a decided bout', () => {
    const mountAt = async (boutId, target) => {
      await dispatch('bout:created', { boutId, weapon: 'foil', participants: {}, format: { targetScore: target, periodLengthSeconds: 180, periodCount: 1 } });
      return mountFor(boutId);
    };

    it('stays hidden until a fencer reaches the target score', async () => {
      const el = await mountAt('bt1', 3);
      const icon = () => el.shadowRoot.querySelector('#complete-icon-btn');

      expect(icon().hidden).toBe(true);
      await hold(el.shadowRoot.querySelector('#tap-a'));
      await hold(el.shadowRoot.querySelector('#tap-a'));
      expect(icon().hidden).toBe(true);

      await hold(el.shadowRoot.querySelector('#tap-a'));
      expect(icon().hidden).toBe(false);
    });

    it('offers the end without taking it — the bout keeps running', async () => {
      const el = await mountAt('bt2', 1);
      await hold(el.shadowRoot.querySelector('#tap-b'));

      expect(el.shadowRoot.querySelector('#complete-icon-btn').hidden).toBe(false);
      // Decided, not over: the referee still calls it, and may void a touch
      // or carry on.
      expect(getState().bouts.bt2.status).toBe('in-progress');

      await hold(el.shadowRoot.querySelector('#tap-a'));
      expect(getState().bouts.bt2.scoreAfter).toEqual({ A: 1, B: 1 });
    });

    it('asks for confirmation, same as the one in the log', async () => {
      const el = await mountAt('bt3', 1);
      await hold(el.shadowRoot.querySelector('#tap-a'));

      await click(el.shadowRoot.querySelector('#complete-icon-btn'));

      expect(el.shadowRoot.querySelector('#complete-confirm-modal').shadowRoot.querySelector('dialog').open).toBe(true);
      expect(getState().bouts.bt3.status).toBe('in-progress');
    });

    it('disappears again if the deciding touch is voided', async () => {
      const el = await mountAt('bt4', 1);
      await hold(el.shadowRoot.querySelector('#tap-a'));
      expect(el.shadowRoot.querySelector('#complete-icon-btn').hidden).toBe(false);

      await dispatch('touch:voided', { boutId: 'bt4', targetEventId: getState().touchesByBout.bt4[0].eventId });
      await flush();

      expect(el.shadowRoot.querySelector('#complete-icon-btn').hidden).toBe(true);
    });
  });

  describe('periods', () => {
    const mountWith = async (boutId, format) => {
      await dispatch('bout:created', { boutId, weapon: 'foil', participants: {}, format });
      return mountFor(boutId);
    };

    // Both of these buttons are slotted into match-timer, so a press on
    // them also reaches the host's tap gesture unless the timer ignores
    // taps that began on slotted content. Left unguarded, End Bout started
    // the clock and the period button looked like it "just started the
    // timer" on a single-period bout where advancing is a no-op.
    it('the period button advances without starting the clock', async () => {
      const el = await mountWith('bps', { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
      const timer = el.shadowRoot.querySelector('#match-timer');

      await tap(el.shadowRoot.querySelector('#next-period-btn'));
      await click(el.shadowRoot.querySelector('#next-period-btn'));

      expect(timer.running).toBe(false);
      expect(timer.currentPeriod).toBe(2);
    });

    it('advances the period from the button beside the clock', async () => {
      const el = await mountWith('bp1', { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
      const timer = el.shadowRoot.querySelector('#match-timer');
      expect(timer.currentPeriod).toBe(1);

      await click(el.shadowRoot.querySelector('#next-period-btn'));

      expect(timer.currentPeriod).toBe(2);
      expect(timer.remainingSeconds).toBe(180);
      expect(timer.running).toBe(false);
    });

    it('a single-period bout shows neither period control, nor a period count', async () => {
      const el = await mountWith('bpv1', { targetScore: 5, periodLengthSeconds: 180, periodCount: 1 });
      const timer = el.shadowRoot.querySelector('#match-timer');

      expect(el.shadowRoot.querySelector('#next-period-btn').hidden).toBe(true);
      expect(el.shadowRoot.querySelector('#prev-period-btn').hidden).toBe(true);
      expect(timer.shadowRoot.querySelector('#meta').textContent).toBe('foil');
    });

    it('withholds forward on the live screen until the period has run out', async () => {
      const el = await mountWith('bpv2', { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
      const next = () => el.shadowRoot.querySelector('#next-period-btn');
      const timer = el.shadowRoot.querySelector('#match-timer');

      // Time still on the clock: moving on would be a mis-tap, not a choice.
      expect(next().hidden).toBe(true);
      expect(el.shadowRoot.querySelector('#prev-period-btn').hidden).toBe(true);

      // Run the clock out the way the timer itself announces it. (Driving
      // the real interval under swapped-in fake timers doesn't work — it
      // was registered against the real clock at mount.)
      timer.restore({ period: 1, remainingSeconds: 0 });
      timer.dispatchEvent(new CustomEvent('timer-expired', {
        bubbles: true, composed: true, detail: { period: 1, isFinalPeriod: false },
      }));
      await flush();

      expect(timer.remainingSeconds).toBe(0);
      expect(next().hidden).toBe(false);
    });

    it('offers forward regardless of the clock once the log is open', async () => {
      const el = await mountWith('bpv2b', { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
      expect(el.shadowRoot.querySelector('#next-period-btn').hidden).toBe(true);

      el.shadowRoot.querySelector('#deck-handle').click();

      // The log view is for corrections, so both controls are available.
      expect(el.shadowRoot.querySelector('#next-period-btn').hidden).toBe(false);
    });

    it('hides forward on the last period; back only appears with the log open', async () => {
      const el = await mountWith('bpv3', { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
      const next = () => el.shadowRoot.querySelector('#next-period-btn');
      const prev = () => el.shadowRoot.querySelector('#prev-period-btn');
      const openDeck = () => el.shadowRoot.querySelector('#deck-handle').click();

      openDeck();
      await click(next());
      expect(next().hidden).toBe(false);
      expect(prev().hidden).toBe(false);

      openDeck(); // close — back is a correction, not a live-screen action
      expect(prev().hidden).toBe(true);
      openDeck();

      await click(next());
      expect(el.shadowRoot.querySelector('#match-timer').currentPeriod).toBe(3);
      expect(next().hidden).toBe(true);   // last period — nothing ahead
    });

    it('remembers each period\'s own clock', async () => {
      const el = await mountWith('bpmem', { targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
      const timer = el.shadowRoot.querySelector('#match-timer');
      el.shadowRoot.querySelector('#deck-handle').click();

      // Leave period 1 part-way through.
      timer.restore({ period: 1, remainingSeconds: 95 });
      const leftAt = Math.round(timer.remainingSeconds);
      expect(leftAt).toBe(95);

      await click(el.shadowRoot.querySelector('#next-period-btn'));
      // A period never visited starts full.
      expect(timer.remainingSeconds).toBe(180);

      await click(el.shadowRoot.querySelector('#prev-period-btn'));
      // Going back is a correction — the time already run is real.
      expect(Math.round(timer.remainingSeconds)).toBe(leftAt);

      await click(el.shadowRoot.querySelector('#next-period-btn'));
      expect(timer.remainingSeconds).toBe(180);
    });

    it('goes back a period, restoring the full clock', async () => {
      const el = await mountWith('bpv4', { targetScore: 15, periodLengthSeconds: 180, periodCount: 2 });
      const timer = el.shadowRoot.querySelector('#match-timer');
      el.shadowRoot.querySelector('#deck-handle').click(); // both live in the log view

      await click(el.shadowRoot.querySelector('#next-period-btn'));
      expect(timer.currentPeriod).toBe(2);

      await click(el.shadowRoot.querySelector('#prev-period-btn'));
      expect(timer.currentPeriod).toBe(1);
      expect(timer.remainingSeconds).toBe(180);
      expect(timer.running).toBe(false);
    });

    it('marks the clock as final-period when there is nothing to advance to', async () => {
      // A pool bout is a single period — the control has nothing to do, which
      // is why it appeared to do nothing when it lived in the menu.
      const el = await mountWith('bp2', { targetScore: 5, periodLengthSeconds: 180, periodCount: 1 });
      const timer = el.shadowRoot.querySelector('#match-timer');

      expect(timer.canAdvancePeriod).toBe(false);
      expect(timer.hasAttribute('data-final-period')).toBe(true);

      await click(el.shadowRoot.querySelector('#next-period-btn'));
      expect(timer.currentPeriod).toBe(1);
    });

    it('becomes final once the last period is reached', async () => {
      const el = await mountWith('bp3', { targetScore: 15, periodLengthSeconds: 180, periodCount: 2 });
      const timer = el.shadowRoot.querySelector('#match-timer');
      expect(timer.hasAttribute('data-final-period')).toBe(false);

      await click(el.shadowRoot.querySelector('#next-period-btn'));

      expect(timer.currentPeriod).toBe(2);
      expect(timer.hasAttribute('data-final-period')).toBe(true);
    });
  });

  describe('clock sound', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bsnd', weapon: 'foil', participants: {} });
      el = await mountFor('bsnd');
    });

    const timer = () => el.shadowRoot.querySelector('#match-timer');

    it('defaults to on at full volume', () => {
      expect(timer().soundEnabled).toBe(true);
      expect(timer().soundVolume).toBe(1);
    });

    it('turning it off mutes the clock and hides the volume control', async () => {
      const toggle = el.shadowRoot.querySelector('#sound-enabled');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      expect(timer().soundEnabled).toBe(false);
      expect(el.shadowRoot.querySelector('#sound-volume-field').hidden).toBe(true);
    });

    it('volume reaches the clock as a 0–1 fraction', async () => {
      const slider = el.shadowRoot.querySelector('#sound-volume');
      slider.value = '40';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();

      expect(timer().soundVolume).toBeCloseTo(0.4, 5);
    });

    it('survives leaving and reopening the bout — it is a device setting', async () => {
      const toggle = el.shadowRoot.querySelector('#sound-enabled');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      document.body.innerHTML = '';
      const again = await mountFor('bsnd');
      expect(again.shadowRoot.querySelector('#match-timer').soundEnabled).toBe(false);
    });
  });

  describe('leaving the screen', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'b2', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } } });
      el = await mountFor('b2');
    });

    it('back returns to the list and leaves the bout in progress', async () => {
      await click(el.shadowRoot.querySelector('#back-btn'));
      expect(getState().bouts.b2.status).toBe('in-progress');
      expect(location.pathname).toBe('/');
    });

    it('ending the bout asks first, summarising the score', async () => {
      await hold(el.shadowRoot.querySelector('#tap-a'));
      await click(el.shadowRoot.querySelector('#complete-btn'));

      const dialog = el.shadowRoot.querySelector('#complete-confirm-modal');
      expect(dialog.shadowRoot.querySelector('dialog').open).toBe(true);
      expect(el.shadowRoot.querySelector('#complete-summary').textContent).toBe('End this bout at Alice 1 – 0 Bob?');
      expect(getState().bouts.b2.status).toBe('in-progress');
    });

    it('confirming ends the bout and returns to the list', async () => {
      await click(el.shadowRoot.querySelector('#complete-btn'));
      await click(el.shadowRoot.querySelector('#complete-confirm-btn'));

      expect(getState().bouts.b2.status).toBe('complete');
      expect(location.pathname).toBe('/');
    });

    it('declining keeps the bout in progress', async () => {
      await click(el.shadowRoot.querySelector('#complete-btn'));
      await click(el.shadowRoot.querySelector('#complete-cancel-btn'));

      expect(getState().bouts.b2.status).toBe('in-progress');
    });
  });

  // Detail capture (action type, piste/body location, off-target) is
  // deliberately absent while the app is scoped to refereeing — see the
  // note on CapturePage. These assert the simple path stays simple.
  describe('simple point entry', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bs', weapon: 'epee', participants: {}, presetId: 'full-analyst' });
      el = await mountFor('bs');
    });

    it('logs immediately on hold, with no detail sheet in between', async () => {
      await hold(el.shadowRoot.querySelector('#tap-a'));

      expect(getState().touchesByBout.bs).toHaveLength(1);
      expect(getState().bouts.bs.scoreAfter).toEqual({ A: 1, B: 0 });
      expect(el.shadowRoot.querySelector('#detail-modal')).toBeNull();
    });

    it('records every touch as valid — there is no off-target call to make', async () => {
      await hold(el.shadowRoot.querySelector('#tap-a'));
      expect(getState().touchesByBout.bs[0]).toMatchObject({ valid: true });
      expect(getState().touchesByBout.bs[0].actionType).toBeUndefined();
      expect(getState().touchesByBout.bs[0].bodyLocation).toBeUndefined();
    });

    it('ignores the preset on the bout — the richer presets drive nothing yet', async () => {
      // presetId is still carried on the event so they can return later.
      expect(getState().bouts.bs.presetId).toBe('full-analyst');
      await hold(el.shadowRoot.querySelector('#tap-b'));
      expect(getState().touchesByBout.bs).toHaveLength(1);
    });
  });

  describe('a double touch is simultaneous, not sequential', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bdt', weapon: 'epee', participants: {} });
      el = await mountFor('bdt');
      await hold(el.shadowRoot.querySelector('#tap-a'));   // 1-0 first
    });

    const dbl = async () => { await hold(el.shadowRoot.querySelector('#double-btn')); await flush(); };

    it('gives both fencers the same score — neither arrives first', async () => {
      await dbl();

      const [, x, y] = getState().touchesByBout.bdt;
      expect(x.scoreAfter).toEqual({ A: 2, B: 1 });
      expect(y.scoreAfter).toEqual({ A: 2, B: 1 });
      expect(x.pairId).toBe(y.pairId);
      expect(x.occurredAt).toBe(y.occurredAt);
    });

    it('survives a recompute — voiding something earlier must not re-sequence it', async () => {
      await dbl();
      const first = getState().touchesByBout.bdt[0];

      await dispatch('touch:voided', { boutId: 'bdt', targetEventId: first.eventId });
      await flush();

      const [, x, y] = getState().touchesByBout.bdt;
      expect(x.scoreAfter).toEqual({ A: 1, B: 1 });
      expect(y.scoreAfter).toEqual({ A: 1, B: 1 });
    });

    it('reads as one row in the log', async () => {
      await dbl();
      const rows = [...el.shadowRoot.querySelectorAll('.log-row')]
        .map(r => ({ kind: r.dataset.kind, text: r.textContent.replace(/\s+/g, ' ').trim() }));

      expect(rows[0].kind).toBe('double');
      expect(rows[0].text).toContain('Double — 2–1');
      expect(rows).toHaveLength(2); // the double, plus the earlier single touch
    });

    it('voids both halves together', async () => {
      await dbl();
      expect(getState().bouts.bdt.scoreAfter).toEqual({ A: 2, B: 1 });

      await swipeLeft(el.shadowRoot.querySelector('.log-row'));
      await click(el.shadowRoot.querySelector('#void-confirm-btn'));
      await flush();
      await flush();

      expect(getState().bouts.bdt.scoreAfter).toEqual({ A: 1, B: 0 });
      expect(getState().touchesByBout.bdt.filter(t => t.voided)).toHaveLength(2);
    });
  });

  describe('double touch (épée only)', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'b7', weapon: 'epee', participants: {} });
      el = await mountFor('b7');
    });

    it('is visible for épée', () => {
      expect(el.shadowRoot.querySelector('#double-btn').hidden).toBe(false);
    });

    it('holding it scores both sides at once', async () => {
      await hold(el.shadowRoot.querySelector('#double-btn'));
      await flush(); // two sequential dispatch round-trips

      expect(getState().bouts.b7.scoreAfter).toEqual({ A: 1, B: 1 });
      expect(getState().touchesByBout.b7).toHaveLength(2);
      expect(getState().touchesByBout.b7.every(t => t.valid)).toBe(true);
    });

    it('halts the clock like any other score', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      timer.start();
      await hold(el.shadowRoot.querySelector('#double-btn'));
      expect(timer.running).toBe(false);
    });
  });

  describe('giving a card', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'bc', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } } });
      el = await mountFor('bc');
    });

    const picker = () => el.shadowRoot.querySelector('#card-picker');
    const pages = () => [...picker().shadowRoot.querySelectorAll('.page')].map(p => p.dataset.type);
    const openRack = async side => {
      el.shadowRoot.querySelector(`#rack-${side}`).shadowRoot.querySelector('#btn').click();
      await flush();
    };
    const apply = async () => {
      picker().shadowRoot.querySelector('#apply').click();
      await flush();
    };

    it('opens from the fencer\'s own rack, offering all three cards', async () => {
      await openRack('a');
      expect(picker().hasAttribute('open')).toBe(true);
      expect(pages()).toEqual(['yellow', 'red', 'black']);
    });

    it('names the fencer on every page and on the apply button', async () => {
      await openRack('b');
      const forLabels = [...picker().shadowRoot.querySelectorAll('.page .for')].map(e => e.textContent);
      expect(forLabels).toEqual(['Bob', 'Bob', 'Bob']);
      expect(picker().shadowRoot.querySelector('#apply').textContent).toBe('Apply yellow to Bob');
    });

    it('applies the card the referee has swiped to', async () => {
      await openRack('a');
      await apply(); // first page — yellow

      expect(getState().bouts.bc.cardCounts.A).toEqual({ yellow: 1, red: 0, black: 0 });
      expect(picker().hasAttribute('open')).toBe(false);
      expect(el.shadowRoot.querySelector('#rack-a').getAttribute('cards')).toBe('1,0,0');
    });

    it('drops yellow from the deck once given, opening on red', async () => {
      await openRack('a');
      await apply();
      await openRack('a');

      // A fencer holds at most one yellow, so it stops being offered.
      expect(pages()).toEqual(['red', 'black']);
      expect(picker().currentCard).toBe('red');
      expect(picker().shadowRoot.querySelector('#apply').textContent).toBe('Apply red to Alice');
    });

    it('keeps offering yellow to the fencer who has none', async () => {
      await openRack('a');
      await apply();
      await openRack('b');

      expect(pages()).toEqual(['yellow', 'red', 'black']);
      expect(picker().currentCard).toBe('yellow');
    });

    it('shows how many of each card the fencer already holds', async () => {
      await dispatch('card:issued', { boutId: 'bc', against: 'A', cardType: 'red' });
      await dispatch('card:issued', { boutId: 'bc', against: 'A', cardType: 'red' });
      await flush();
      await openRack('a');

      const held = [...picker().shadowRoot.querySelectorAll('.page .held')].map(e => e.textContent);
      expect(held).toEqual(['None given', '2 already given', 'None given']);
    });

    it('cancel closes without giving anything', async () => {
      await openRack('a');
      picker().shadowRoot.querySelector('#cancel').click();
      await flush();

      expect(picker().hasAttribute('open')).toBe(false);
      expect(getState().bouts.bc.cardCounts.A.yellow).toBe(0);
    });

    it('Escape also cancels', async () => {
      await openRack('a');
      picker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(picker().hasAttribute('open')).toBe(false);
    });

    it('a red buzzes like a scored point, since it puts one on the board', async () => {
      const vibrate = vi.fn();
      vi.stubGlobal('navigator', { ...navigator, vibrate });

      await openRack('a');
      picker()._index = picker()._options.indexOf('red');
      picker()._syncCurrent();
      vibrate.mockClear();
      await apply();
      await flush();
      expect(vibrate).toHaveBeenCalledWith(120);

      vi.unstubAllGlobals();
    });

    it('a yellow gets only the short pulse — nothing reached the board', async () => {
      const vibrate = vi.fn();
      vi.stubGlobal('navigator', { ...navigator, vibrate });

      await openRack('b');
      picker()._index = picker()._options.indexOf('yellow');
      picker()._syncCurrent();
      vibrate.mockClear();
      await apply();
      await flush();

      expect(vibrate).toHaveBeenCalledWith(30);
      expect(vibrate).not.toHaveBeenCalledWith(120);

      vi.unstubAllGlobals();
    });

    it('a red given this way still awards the opponent a point', async () => {
      await openRack('a');
      picker()._index = picker()._options.indexOf('red');
      picker()._syncCurrent();
      await apply();
      await flush();

      expect(getState().bouts.bc.cardCounts.A.red).toBe(1);
      expect(getState().bouts.bc.scoreAfter).toEqual({ A: 0, B: 1 });
      expect(getState().touchesByBout.bc[0]).toMatchObject({ scoredBy: 'B', awardedBy: 'red-card' });
    });

    // The picker gives cards; it no longer takes them back (a control that
    // appeared only for held cards changed the footer height between
    // cards). Withdrawal moves to the bout log, so these drive the page's
    // method directly until that UI exists.
    it('withdrawing a card decrements the rack', async () => {
      await openRack('a');
      await apply();                                   // yellow
      expect(el.shadowRoot.querySelector('#rack-a').getAttribute('cards')).toBe('1,0,0');

      await el._revokeCard(cardIdAt(el, 0));
      await flush();

      expect(getState().bouts.bc.cardCounts.A.yellow).toBe(0);
      expect(el.shadowRoot.querySelector('#rack-a').getAttribute('cards')).toBe('0,0,0');
    });

    it('withdrawing a red also takes back the point it awarded', async () => {
      await openRack('a');
      picker()._index = picker()._options.indexOf('red');
      picker()._syncCurrent();
      await apply();
      await flush();
      expect(getState().bouts.bc.scoreAfter).toEqual({ A: 0, B: 1 });

      await el._revokeCard(cardIdAt(el, 0));
      await flush();

      expect(getState().bouts.bc.cardCounts.A.red).toBe(0);
      expect(getState().bouts.bc.scoreAfter).toEqual({ A: 0, B: 0 });
      expect(getState().touchesByBout.bc[0]).toMatchObject({ voided: true, awardedBy: 'red-card' });
    });

    it('withdrawing one of several reds takes back exactly one point', async () => {
      for (const _ of [1, 2, 3]) {
        await openRack('a');
        picker()._index = 1;
        picker()._syncCurrent();
        await apply();
        await flush();
      }
      expect(getState().bouts.bc.scoreAfter).toEqual({ A: 0, B: 3 });

      await el._revokeCard(cardIdAt(el, 0));
      await flush();

      expect(getState().bouts.bc.cardCounts.A.red).toBe(2);
      expect(getState().bouts.bc.scoreAfter).toEqual({ A: 0, B: 2 });
    });

    it('a black is recorded without awarding or ending anything', async () => {
      await openRack('a');
      picker()._index = picker()._options.indexOf('black');
      picker()._syncCurrent();
      await apply();

      expect(getState().bouts.bc.cardCounts.A.black).toBe(1);
      expect(getState().bouts.bc.scoreAfter).toEqual({ A: 0, B: 0 });
      expect(getState().bouts.bc.status).toBe('in-progress');
    });

    it('opening the rack halts a running clock first', async () => {
      const timer = el.shadowRoot.querySelector('#match-timer');
      timer.start();
      expect(timer.running).toBe(true);

      await openRack('a');

      // A card is always called at halt; leaving the clock running behind
      // a full-screen picker would be the worst possible failure.
      expect(timer.running).toBe(false);
      expect(picker().hasAttribute('open')).toBe(true);
    });

    it('renders the rack as fixed slots, counting reds rather than repeating them', async () => {
      const rack = () => [...el.shadowRoot.querySelector('#rack-a').shadowRoot
        .querySelectorAll('.card')]
        .map(c => `${c.className.replace('card ', '').replace(' on', '+')}${c.textContent}`);

      expect(rack()).toEqual(['yellow', 'red']);

      await dispatch('card:issued', { boutId: 'bc', against: 'A', cardType: 'yellow' });
      await flush();
      expect(rack()).toEqual(['yellow+', 'red']);

      await dispatch('card:issued', { boutId: 'bc', against: 'A', cardType: 'red' });
      await flush();
      expect(rack()).toEqual(['yellow+', 'red+']);

      await dispatch('card:issued', { boutId: 'bc', against: 'A', cardType: 'red' });
      await flush();
      expect(rack()).toEqual(['yellow+', 'red+2']);

      await dispatch('card:issued', { boutId: 'bc', against: 'A', cardType: 'black' });
      await flush();
      expect(rack()).toEqual(['yellow+', 'red+2', 'black+']);
    });
  });

  describe('bout actions sheet', () => {
    let el;

    beforeEach(async () => {
      await dispatch('bout:created', { boutId: 'b8', weapon: 'foil', participants: { A: { label: 'Alice' }, B: { label: 'Bob' } } });
      el = await mountFor('b8');
      await click(el.shadowRoot.querySelector('#officiating-btn'));
    });

    it('opens without covering the scoring halves in the DOM order', () => {
      expect(el.shadowRoot.querySelector('#officiating-modal').shadowRoot.querySelector('dialog').open).toBe(true);
    });

    it('no longer offers timeouts or priority — deferred, not deleted', () => {
      expect(el.shadowRoot.querySelector('#timeout-a-btn')).toBeNull();
      expect(el.shadowRoot.querySelector('#determine-priority-btn')).toBeNull();
    });

    it('carries the clock-sound settings', () => {
      expect(el.shadowRoot.querySelector('#sound-enabled').checked).toBe(true);
      expect(el.shadowRoot.querySelector('#sound-volume').value).toBe('100');
    });

    it('offers the three warning marks, with only 30s on by default', () => {
      const marks = [...el.shadowRoot.querySelectorAll('#warn-marks button')]
        .map(b => [b.textContent, b.getAttribute('aria-pressed')]);
      expect(marks).toEqual([['1 min', 'false'], ['30s', 'true'], ['10s', 'false']]);
      expect(el.shadowRoot.querySelector('#match-timer').warnAt).toEqual([30]);
    });

    it('toggling a mark reaches the clock and survives a remount', async () => {
      const markBtn = m => el.shadowRoot.querySelector(`#warn-marks button[data-mark="${m}"]`);

      await click(markBtn(10));
      expect(el.shadowRoot.querySelector('#match-timer').warnAt).toEqual([30, 10]);

      await click(markBtn(30));
      expect(el.shadowRoot.querySelector('#match-timer').warnAt).toEqual([10]);

      document.body.innerHTML = '';
      const again = await mountFor('b8');
      expect(again.shadowRoot.querySelector('#match-timer').warnAt).toEqual([10]);
    });

    it('hides the marks when sound is off — they have nothing to play', async () => {
      const toggle = el.shadowRoot.querySelector('#sound-enabled');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      expect(el.shadowRoot.querySelector('#warn-field').hidden).toBe(true);
    });

    it('lists touches newest first, and swiping one left voids it', async () => {
      await hold(el.shadowRoot.querySelector('#tap-a'));
      await hold(el.shadowRoot.querySelector('#tap-b'));
      expect(getState().bouts.b8.scoreAfter).toEqual({ A: 1, B: 1 });

      const rows = () => [...el.shadowRoot.querySelectorAll('.log-row')]
        .map(r => r.textContent.replace(/\s+/g, ' ').trim());
      // Most recent at the top — the thing a referee is checking.
      // The score already says the touch counted, so that column now
      // carries when it happened instead.
      expect(rows()[0]).toBe('Red — 1–1 P1 3:00');
      expect(rows()[1]).toBe('Green — 1–0 P1 3:00');

      await swipeLeft(el.shadowRoot.querySelector('.log-row'));
      await click(el.shadowRoot.querySelector('#void-confirm-btn'));

      expect(getState().bouts.b8.scoreAfter).toEqual({ A: 1, B: 0 });
    });
  });

  describe('period expiry', () => {
    // The clock reaching zero is match-timer's own concern (covered in
    // match-timer.test.js). What matters here is how the page reacts to the
    // `timer-expired` it emits, so these drive that event directly rather
    // than trying to run a real interval under swapped-in fake timers.
    const expire = async (el, detail) => {
      el.shadowRoot.querySelector('#match-timer')
        .dispatchEvent(new CustomEvent('timer-expired', { bubbles: true, composed: true, detail }));
      await flush();
    };
    const sheetOpen = el => el.shadowRoot.querySelector('#officiating-modal').shadowRoot.querySelector('dialog').open;

    it('opens the actions sheet when the final period ends level, so priority gets assigned', async () => {
      await dispatch('bout:created', { boutId: 'b9', weapon: 'foil', participants: {} });
      const el = await mountFor('b9');

      await expire(el, { period: 3, isFinalPeriod: true }); // 0–0, level

      expect(sheetOpen(el)).toBe(true);
    });

    it('does not interrupt when the final period ends with a winner', async () => {
      await dispatch('bout:created', { boutId: 'b10', weapon: 'foil', participants: {} });
      const el = await mountFor('b10');
      await hold(el.shadowRoot.querySelector('#tap-a')); // 1–0

      await expire(el, { period: 3, isFinalPeriod: true });

      expect(sheetOpen(el)).toBe(false);
    });

    it('does not interrupt when a non-final period ends', async () => {
      await dispatch('bout:created', { boutId: 'b11', weapon: 'foil', participants: {} });
      const el = await mountFor('b11');

      await expire(el, { period: 1, isFinalPeriod: false });

      expect(sheetOpen(el)).toBe(false);
    });
  });

});
