// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, reset, dispatch, getState, setState } from '../../_lib/core/store/store.js';
import { reducer } from '../../app/store/reducer.js';
import '../../_lib/core/app-element.js';
import '../../_lib/modules/app-header/app-header.js';
import '../../_lib/modules/modal-dialog/modal-dialog.js';
import '../../app/pages/home-page.js';

HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};

let dbSeq = 0;
function freshName() { return `test-home-page-${dbSeq++}`; }

const pdown = (el, x = 0, y = 0) => el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
const pmove = (el, x, y) => el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
const pup = (el, x = 0, y = 0) => el.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));

// fake-indexeddb resolves dispatch()'s underlying put() on a real task, not
// just a microtask — needed after any interaction whose handler calls
// dispatch() without awaiting it (e.g. a click handler).
const flush = () => new Promise(r => setTimeout(r, 0));

// Retries until the assertions hold, rather than asserting once after a fixed
// delay. A single flush() is one macrotask, and the write/reduce/render chain a
// click kicks off is not guaranteed to finish inside it — under load (running
// with --coverage is enough) it does not, which made these tests intermittent.
// Wait for the postcondition, never for a duration.
const settled = fn => vi.waitFor(fn, { timeout: 2000, interval: 5 });

describe('home-page', () => {
  let el;

  beforeEach(async () => {
    reset();
    await boot({ dbName: freshName(), reducer });
    el = document.createElement('home-page');
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
    document.body.innerHTML = '';
  });

  it('shows the empty-state message with no bouts', () => {
    expect(el.shadowRoot.querySelector('#empty-msg').hidden).toBe(false);
  });

  it('New Bout with defaults creates an in-progress foil bout and navigates to capture', async () => {
    const sr = el.shadowRoot;
    sr.querySelector('#new-bout-btn').click();
    sr.querySelector('#start-btn').click();

    await settled(() => expect(location.pathname).toMatch(/^\/bout\/.+\/capture$/));
  });

  it('lists a created bout with its weapon and status', async () => {
    const sr = el.shadowRoot;
    sr.querySelector('#new-bout-btn').click();
    sr.querySelector('[name="weapon"][value="epee"]').click();
    sr.querySelector('#start-btn').click();

    await settled(() => {
      const row = sr.querySelector('.row');
      expect(row).toBeTruthy();
      // The row shows the DISPLAY form, not the stored enum. It used to render
      // "epee" and "in-progress" straight from the event, which is data
      // leaking onto the screen and untranslatable by construction.
      expect(row.textContent).toContain('Épée');
      expect(row.textContent).toContain('in progress');
      expect(row.textContent).not.toContain('epee');
      expect(sr.querySelector('#empty-msg').hidden).toBe(true);
    });
  });

  it('escapes participant labels from an imported bout rather than rendering them as HTML', async () => {
    await dispatch('bout:created', {
      boutId: 'evil-1', weapon: 'foil',
      participants: { A: { label: '<img src=x onerror=alert(1)>' }, B: { label: 'Bob' } },
    });

    await settled(() => {
      const row = el.shadowRoot.querySelector('.row');
      expect(row.querySelector('img')).toBeNull();
      expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
    });
  });

  it('swiping a row left opens the delete-confirm modal, and confirming soft-deletes it', async () => {
    await dispatch('bout:created', { boutId: 'b1', weapon: 'foil', participants: {} });

    await settled(() => expect(el.shadowRoot.querySelector('.row[data-id="b1"]')).toBeTruthy());
    const row = el.shadowRoot.querySelector('.row[data-id="b1"]');
    pdown(row, 100, 0); pmove(row, 50, 2); pup(row, 50, 2);

    const modal = el.shadowRoot.querySelector('#delete-confirm-modal');
    expect(modal.hasAttribute('open') || modal.shadowRoot.querySelector('dialog').open).toBeTruthy();

    el.shadowRoot.querySelector('#confirm-delete-btn').click();
    await settled(() => expect(getState().bouts.b1.deleted).toBe(true));
  });

  describe('identifying a bout in the list', () => {
    const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime();
    const row = () => el.shadowRoot.querySelector('.row');

    it('titles an unnamed bout by when it started', async () => {
      await dispatch('bout:created', { boutId: 'n1', weapon: 'foil', participants: {} }, at(2026, 9, 27, 14, 32));
      await flush();

      // Every row said "Untitled bout" before, which identified nothing.
      // Big-endian so it is unambiguous in every locale and needs no month names.
      await settled(() => expect(row().querySelector('.names').textContent).toBe('2026.10.27 14:32'));
    });

    it('still prefers real names once they exist', async () => {
      await dispatch('bout:created', { boutId: 'n2', weapon: 'foil', participants: { A: { label: 'Alice' } } });
      await flush();
      await settled(() => expect(row().querySelector('.names').textContent).toBe('Alice vs Red'));
    });

    it('shows when a bout ended, and nothing while it is unfinished', async () => {
      await dispatch('bout:created', { boutId: 'n3', weapon: 'foil', participants: {} });
      await flush();
      await settled(() => expect(row().querySelector('.completed').textContent).toBe(''));

      await dispatch('bout:completed', { boutId: 'n3' }, at(2026, 9, 27, 15, 5));
      await flush();

      await settled(() => expect(row().querySelector('.completed').textContent).toBe('ended 2026.10.27 15:05'));
    });

    it('falls back to the last recorded activity when no completion time exists', async () => {
      await dispatch('bout:created', { boutId: 'n4', weapon: 'foil', participants: {} });
      await dispatch('touch:scored', {
        boutId: 'n4', touchId: 't1', scoredBy: 'A', valid: true, scoreAfter: { A: 1, B: 0 },
      }, at(2026, 9, 27, 16, 20));
      await flush();

      // Simulates a bout completed before completedAt was recorded.
      const bouts = getState().bouts;
      setState('bouts', { ...bouts, n4: { ...bouts.n4, status: 'complete', completedAt: undefined } });
      await flush();

      await settled(() => expect(row().querySelector('.completed').textContent).toBe('ended 2026.10.27 16:20'));
    });
  });

  describe('opening a bout', () => {
    // A real click, because opening a row is a click listener. Socle 1.6.0
    // gave Gestures.attach() tap support, so that is now a choice rather than
    // a workaround — see the note in home-page.js.
    const tapRow = async r => { r.click(); await flush(); };

    it('reopens an unfinished bout', async () => {
      await dispatch('bout:created', { boutId: 'o1', weapon: 'foil', participants: {} });
      await flush();

      await tapRow(el.shadowRoot.querySelector('.row'));

      await settled(() => expect(location.pathname).toBe('/bout/o1/capture'));
    });

    it('does nothing for a finished one — there is no completed-bout view yet', async () => {
      await dispatch('bout:created', { boutId: 'o2', weapon: 'foil', participants: {} });
      await dispatch('bout:completed', { boutId: 'o2' });
      await flush();
      history.replaceState({}, '', '/');

      await tapRow(el.shadowRoot.querySelector('.row'));

      expect(location.pathname).toBe('/');
    });

    // The rows carry tabindex="0" and a keydown handler, so this is a real
    // path a keyboard or switch user takes — and it had no coverage at all.
    describe('from the keyboard', () => {
      const press = async (row, key) => {
        row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await flush();
      };

      it('opens a bout on Enter', async () => {
        await dispatch('bout:created', { boutId: 'k1', weapon: 'foil', participants: {} });
        await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());

        await press(el.shadowRoot.querySelector('.row'), 'Enter');

        expect(location.pathname).toBe('/bout/k1/capture');
      });

      it('opens a bout on Space, the other activation key', async () => {
        await dispatch('bout:created', { boutId: 'k2', weapon: 'foil', participants: {} });
        await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());

        await press(el.shadowRoot.querySelector('.row'), ' ');

        expect(location.pathname).toBe('/bout/k2/capture');
      });

      it('ignores keys that are not activations, so arrowing through the list is safe', async () => {
        await dispatch('bout:created', { boutId: 'k3', weapon: 'foil', participants: {} });
        await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());
        history.replaceState({}, '', '/');

        await press(el.shadowRoot.querySelector('.row'), 'ArrowDown');
        await press(el.shadowRoot.querySelector('.row'), 'Tab');

        expect(location.pathname).toBe('/');
      });

      it('will not open a finished bout, matching the click behaviour', async () => {
        await dispatch('bout:created', { boutId: 'k4', weapon: 'foil', participants: {} });
        await dispatch('bout:completed', { boutId: 'k4' });
        await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());
        history.replaceState({}, '', '/');

        await press(el.shadowRoot.querySelector('.row'), 'Enter');

        expect(location.pathname).toBe('/');
      });
    });
  });

  describe('choosing a format for a new bout', () => {
    const chip = id => el.shadowRoot.querySelector(`[data-format-preset="${id}"]`);
    const customFields = () => el.shadowRoot.querySelector('#custom-format-fields');

    beforeEach(() => el.shadowRoot.querySelector('#new-bout-btn').click());

    it('reveals the custom fields only for the Custom preset', () => {
      expect(customFields().hidden).toBe(true);

      chip('custom').click();
      expect(customFields().hidden).toBe(false);

      chip('pool').click();
      expect(customFields().hidden).toBe(true);
    });

    it('marks the chosen preset pressed, and only that one', () => {
      chip('pool').click();

      const pressed = [...el.shadowRoot.querySelectorAll('[data-format-preset]')]
        .filter(b => b.getAttribute('aria-pressed') === 'true')
        .map(b => b.dataset.formatPreset);
      expect(pressed).toEqual(['pool']);
    });

    it('applies a preset format to the bout it creates', async () => {
      chip('pool').click();
      el.shadowRoot.querySelector('#start-btn').click();
      await settled(() => expect(Object.values(getState().bouts ?? {})).toHaveLength(1));

      const [bout] = Object.values(getState().bouts);
      expect(bout.format).toEqual({ targetScore: 5, periodLengthSeconds: 180, periodCount: 1 });
    });

    it('uses the numbers typed into the custom fields', async () => {
      chip('custom').click();
      el.shadowRoot.querySelector('#custom-target-score-input').value = '10';
      el.shadowRoot.querySelector('#custom-period-length-input').value = '240';
      el.shadowRoot.querySelector('#custom-period-count-input').value = '2';

      el.shadowRoot.querySelector('#start-btn').click();
      await settled(() => expect(Object.values(getState().bouts ?? {})).toHaveLength(1));

      const [bout] = Object.values(getState().bouts);
      expect(bout.format).toEqual({ targetScore: 10, periodLengthSeconds: 240, periodCount: 2 });
    });

    it('falls back to a sane bout rather than a broken one when the fields are empty or junk', async () => {
      // These are free-text inputs, so '', 'abc' and '0' all reach here. A
      // periodCount of 0 would be a bout that can never be refereed.
      chip('custom').click();
      el.shadowRoot.querySelector('#custom-target-score-input').value = '';
      el.shadowRoot.querySelector('#custom-period-length-input').value = 'abc';
      el.shadowRoot.querySelector('#custom-period-count-input').value = '0';

      el.shadowRoot.querySelector('#start-btn').click();
      await settled(() => expect(Object.values(getState().bouts ?? {})).toHaveLength(1));

      const [bout] = Object.values(getState().bouts);
      expect(bout.format).toEqual({ targetScore: 15, periodLengthSeconds: 180, periodCount: 3 });
    });
  });

  describe('labelling a bout with nothing to label it by', () => {
    const names = () => el.shadowRoot.querySelector('.row .names').textContent;

    it('falls back to "Bout" when there is no usable creation time', async () => {
      // Reachable from an imported file: createdAt is whatever was in the
      // event. Without the guard this rendered "NaN NaN NaN:NaN".
      await dispatch('bout:created', { boutId: 'nb1', weapon: 'foil', participants: {} }, Number.NaN);
      await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());

      expect(names()).toBe('Bout');
    });

    it('names a half-identified bout against the default for the other side', async () => {
      await dispatch('bout:created', {
        boutId: 'nb2', weapon: 'foil', participants: { B: { label: 'Bob' } },
      });
      await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());

      expect(names()).toBe('Green vs Bob');
    });

    it('shows 0–0 for a bout whose score has not been touched yet', async () => {
      await dispatch('bout:created', { boutId: 'nb3', weapon: 'foil', participants: {} });
      await settled(() => expect(el.shadowRoot.querySelector('.row')).toBeTruthy());

      const row = el.shadowRoot.querySelector('.row');
      expect(row.querySelector('.side-a').textContent).toBe('0');
      expect(row.querySelector('.side-b').textContent).toBe('0');
    });
  });
});
