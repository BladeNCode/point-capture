import { AppElement } from '../../_lib/core/app-element.js';
import { t } from '../../_lib/core/strings.js';
import { Gestures } from '../../_lib/modules/gestures/gestures.js';
import { toast } from '../../_lib/modules/toast/toast.js';
import { dispatch } from '../../_lib/core/store/store.js';
import { navigate } from '../../_lib/core/router/router.js';
import { DEFAULT_PRESET_ID, FORMAT_PRESETS, DEFAULT_FORMAT_PRESET_ID, getFormatPreset } from '../store/presets.js';
import { uuid } from '../store/uuid.js';
import { BOUT_CREATED, BOUT_DELETED } from '../shared/vocabulary/events.js';

// Participant labels can arrive via an imported bout file from another
// device (UC4) — untrusted text. Escape before any innerHTML interpolation.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ISO-ordered, locale-independent, and therefore not a translation problem at
// all — which is why this is better than the two obvious alternatives.
//
// It used to be `27 Oct 14:32` from a hardcoded English MONTHS array, which
// was untranslatable. The reflex fix is Intl.DateTimeFormat, but that trades
// one problem for three: the field ORDER changes per locale (27 Oct / Oct 27 /
// 27.10), so the column width is no longer predictable; the exact output
// depends on the Node ICU build, which makes tests fragile; and a
// day-month-ambiguous format is genuinely unreadable to someone from the
// other convention — 10/27 versus 27/10 has no safe reading.
//
// Big-endian sidesteps all of it. Unambiguous in every locale, sorts
// lexicographically, needs no month names, and stays a fixed 16 characters so
// the score never gets pushed off the row. Nothing here reaches the string
// table because there is nothing in it to translate.
//
// UI only. Times are stored as epoch milliseconds on the event (occurredAt,
// createdAt, completedAt) and formatted at render; no formatted date is ever
// persisted, exported, or compared.
function stamp(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Until fencers can be named, a bout is identified by when it started —
// "Untitled bout" was the same text on every row and told you nothing.
function boutLabel(bout) {
  const a = bout.participants?.A?.label;
  const b = bout.participants?.B?.label;
  if (a || b) {
    return escapeHtml(t('home.vs', { a: a || t('side.A'), b: b || t('side.B') }));
  }
  return escapeHtml(stamp(bout.createdAt) || t('home.untitled'));
}

class HomePage extends AppElement {
  template() {
    return `
      <style>
        :host { display: block; }
        main {
          padding: var(--space-4);
          padding-block-end: calc(var(--space-4) + var(--safe-area-bottom, 0px));
          max-inline-size: 600px;
          margin-inline: auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
        .empty {
          color: var(--color-text-secondary);
          font-size: var(--font-size-body);
          text-align: center;
          padding-block: var(--space-6);
        }
        ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .row {
          background: var(--color-surface);
          border-radius: var(--radius-lg);
          padding: var(--space-3) var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          box-shadow: var(--shadow-card);
          cursor: pointer;
          touch-action: pan-y;
        }
        .row .top { display: flex; justify-content: space-between; align-items: baseline; }
        .row .names { font-weight: var(--font-weight-bold); font-size: var(--font-size-body); }
        .row .score { font-size: var(--font-size-subheading); font-weight: var(--font-weight-bold); }
        .row .score .side-a { color: var(--color-side-a); }
        .row .score .side-b { color: var(--color-side-b); }
        .row .score .dash { color: var(--color-text-muted); font-weight: var(--font-weight-medium); }
        .row .meta { color: var(--color-text-secondary); font-size: var(--font-size-caption); display: flex; gap: var(--space-2); align-items: baseline; }
        .row .completed { color: var(--color-text-muted); font-size: var(--font-size-micro); margin-inline-start: auto; }
        /* A finished bout isn't openable yet — there's no completed-bout
           view, and dropping back into capture would invite editing a
           result that reads as settled. */
        .row.done { cursor: default; }
        .status-badge {
          display: inline-block;
          padding-inline: var(--space-2);
          border-radius: var(--radius-full);
          background: var(--color-accent-subtle);
          color: var(--color-text-primary);
          font-size: var(--font-size-caption);
          font-weight: var(--font-weight-medium);
        }
        button.primary {
          background: var(--color-accent);
          color: var(--color-on-accent);
          border: none;
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-4);
          font-size: var(--font-size-body);
          font-family: var(--font-family);
          font-weight: var(--font-weight-bold);
          min-block-size: var(--touch-target);
          cursor: pointer;
        }
        button.secondary {
          background: var(--color-surface);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-4);
          font-size: var(--font-size-body);
          font-family: var(--font-family);
          min-block-size: var(--touch-target);
          cursor: pointer;
        }
        fieldset { border: none; border-radius: var(--radius-full); padding: var(--space-1); background: var(--color-accent-subtle); display: flex; gap: var(--space-1); margin: 0 0 var(--space-3) 0; }
        legend {
          position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0, 0, 0, 0);
        }
        .radio-label {
          flex: 1; block-size: var(--touch-target); border-radius: var(--radius-full);
          font-size: var(--font-size-caption); font-weight: var(--font-weight-medium);
          color: var(--color-text-secondary); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .radio-label input { position: absolute; opacity: 0; inline-size: 1px; block-size: 1px; pointer-events: none; }
        .radio-label:has(input:checked) { background: var(--color-surface); color: var(--color-text-primary); font-weight: var(--font-weight-bold); box-shadow: var(--shadow-card); }
        .preset-list { display: flex; flex-direction: column; gap: var(--space-2); margin-block-end: var(--space-3); }
        .preset-list button {
          text-align: start; padding: var(--space-3); border-radius: var(--radius-md);
          border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer;
          font-family: var(--font-family); font-size: var(--font-size-body); color: var(--color-text-primary);
        }
        .preset-list button[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent-subtle); font-weight: var(--font-weight-bold); }
        label.field { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); margin-block-end: var(--space-3); }
        input[type="text"] {
          padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md);
          font-size: var(--font-size-body); font-family: var(--font-family); background: var(--color-bg); color: var(--color-text-primary);
        }
      </style>
      <app-header label="Point Capture">
        <button slot="action" class="primary" id="new-bout-btn">${escapeHtml(t('home.new-bout'))}</button>
      </app-header>
      <main>
        <ul id="bout-list"></ul>
        <p class="empty" id="empty-msg" hidden>${escapeHtml(t('home.empty'))}</p>
      </main>

      <modal-dialog id="new-bout-modal" aria-label="${escapeHtml(t('new-bout.title'))}">
        <fieldset id="weapon-field">
          <legend>${escapeHtml(t('new-bout.weapon'))}</legend>
          <label class="radio-label"><input type="radio" name="weapon" value="foil" checked>${escapeHtml(t('weapon.foil'))}</label>
          <label class="radio-label"><input type="radio" name="weapon" value="epee">${escapeHtml(t('weapon.epee'))}</label>
          <label class="radio-label"><input type="radio" name="weapon" value="sabre">${escapeHtml(t('weapon.sabre'))}</label>
        </fieldset>
        <div class="preset-list" id="format-preset-list" role="group" aria-label="${escapeHtml(t('new-bout.format'))}"></div>
        <div id="custom-format-fields" hidden>
          <label class="field">
            ${escapeHtml(t('new-bout.target-score'))}
            <input type="text" inputmode="numeric" id="custom-target-score-input" placeholder="${escapeHtml(t('new-bout.eg-target'))}">
          </label>
          <label class="field">
            ${escapeHtml(t('new-bout.period-length'))}
            <input type="text" inputmode="numeric" id="custom-period-length-input" placeholder="${escapeHtml(t('new-bout.eg-length'))}">
          </label>
          <label class="field">
            ${escapeHtml(t('new-bout.period-count'))}
            <input type="text" inputmode="numeric" id="custom-period-count-input" placeholder="${escapeHtml(t('new-bout.eg-count'))}">
          </label>
        </div>
        <button slot="footer" class="secondary" id="cancel-new-bout-btn">${escapeHtml(t('new-bout.cancel'))}</button>
        <button slot="footer" class="primary" id="start-btn">${escapeHtml(t('new-bout.start'))}</button>
      </modal-dialog>

      <modal-dialog id="delete-confirm-modal" aria-label="${escapeHtml(t('delete-bout.title'))}">
        <p>${escapeHtml(t('delete-bout.prompt'))}</p>
        <button slot="footer" class="secondary" id="cancel-delete-btn">${escapeHtml(t('delete-bout.cancel'))}</button>
        <button slot="footer" class="primary" id="confirm-delete-btn">${escapeHtml(t('delete-bout.confirm'))}</button>
      </modal-dialog>
    `;
  }

  subscribe() {
    const sr = this.shadowRoot;
    // Capture depth isn't a per-bout question while the app is scoped to
    // refereeing — every bout uses the simple entry path. The field stays on
    // the event so the richer presets can return without a migration.
    this._selectedPreset = DEFAULT_PRESET_ID;
    this._selectedFormatPreset = DEFAULT_FORMAT_PRESET_ID;
    this._pendingDeleteId = null;
    this._gestureCleanups = [];

    this._renderFormatPresetChips();

    this.watch('bouts', bouts => this._renderBouts(bouts ?? {}));

    this.listen(sr.querySelector('#new-bout-btn'), 'click', () => sr.querySelector('#new-bout-modal').show());
    this.listen(sr.querySelector('#cancel-new-bout-btn'), 'click', () => sr.querySelector('#new-bout-modal').close());

    this.listen(sr.querySelector('#start-btn'), 'click', () => this._startBout());

    this.listen(sr.querySelector('#cancel-delete-btn'), 'click', () => sr.querySelector('#delete-confirm-modal').close());
    this.listen(sr.querySelector('#confirm-delete-btn'), 'click', () => {
      if (this._pendingDeleteId) {
        dispatch(BOUT_DELETED, { targetId: this._pendingDeleteId, reason: 'user deleted from Home' });
        toast(t('home.deleted'), 'info');
      }
      sr.querySelector('#delete-confirm-modal').close();
    });
  }

  unsubscribe() {
    this._gestureCleanups.forEach(cleanup => cleanup());
    this._gestureCleanups = [];
  }

  _renderFormatPresetChips() {
    const list = this.shadowRoot.querySelector('#format-preset-list');
    list.innerHTML = FORMAT_PRESETS.map(p =>
      `<button type="button" data-format-preset="${p.id}" aria-pressed="${p.id === this._selectedFormatPreset}">${escapeHtml(t(p.labelKey))}</button>`
    ).join('');
    [...list.querySelectorAll('button')].forEach(btn => this.listen(btn, 'click', () => {
      this._selectedFormatPreset = btn.dataset.formatPreset;
      [...list.querySelectorAll('button')].forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      this.shadowRoot.querySelector('#custom-format-fields').hidden = this._selectedFormatPreset !== 'custom';
    }));
  }

  _resolveFormat() {
    const sr = this.shadowRoot;
    const preset = getFormatPreset(this._selectedFormatPreset);
    if (preset.format) return preset.format;

    const targetScore = Number(sr.querySelector('#custom-target-score-input').value) || 15;
    const periodLengthSeconds = Number(sr.querySelector('#custom-period-length-input').value) || 180;
    const periodCount = Number(sr.querySelector('#custom-period-count-input').value) || 3;
    return { targetScore, periodLengthSeconds, periodCount };
  }

  _startBout() {
    const sr = this.shadowRoot;
    const weapon = sr.querySelector('[name="weapon"]:checked').value;
    const boutId = uuid();

    dispatch(BOUT_CREATED, {
      boutId,
      weapon,
      participants: {},
      presetId: this._selectedPreset,
      format: this._resolveFormat(),
    });

    sr.querySelector('#new-bout-modal').close();
    navigate(`/bout/${boutId}/capture`);
  }

  _renderBouts(bouts) {
    // Simplification for Phase 1: swipe directly opens the delete-confirm
    // modal, skipping a visually-revealed intermediate action button — same
    // compensating-event outcome, one less UI mechanic to build right now.
    this._gestureCleanups.forEach(cleanup => cleanup());
    this._gestureCleanups = [];

    const list = this.shadowRoot.querySelector('#bout-list');
    const emptyMsg = this.shadowRoot.querySelector('#empty-msg');
    const visible = Object.values(bouts).filter(b => !b.deleted).sort((a, b) => b.createdAt - a.createdAt);

    emptyMsg.hidden = visible.length > 0;
    list.innerHTML = visible.map(bout => `
      <li class="row ${bout.status === 'complete' ? 'done' : ''}" data-id="${escapeHtml(bout.id)}" data-status="${escapeHtml(bout.status)}" tabindex="0">
        <div class="top">
          <span class="names">${boutLabel(bout)}</span>
          <span class="score"><span class="side-a">${Number(bout.scoreAfter?.A ?? 0)}</span><span class="dash">–</span><span class="side-b">${Number(bout.scoreAfter?.B ?? 0)}</span></span>
        </div>
        <div class="meta">
          <span>${escapeHtml(t(`weapon.${bout.weapon}`))}</span>
          <span class="status-badge">${escapeHtml(t(`status.${bout.status}`))}</span>
          <span class="completed">${bout.status === 'complete' ? escapeHtml(t('home.ended', { when: stamp(bout.completedAt ?? bout.lastActivityAt) })) : ''}</span>
        </div>
      </li>
    `).join('');

    [...list.querySelectorAll('.row')].forEach(row => {
      const id = row.dataset.id;
      // A plain click listener, still — and now by choice rather than by
      // necessity.
      //
      // History, because the comment here used to say something that is no
      // longer true: Gestures.attach() once implemented swipe and hold-drag
      // only, while accepting an onTap handler and silently never calling it.
      // That is why tapping a row did nothing for weeks. Socle 1.6.0 gave
      // attach() the mixin's full gesture set, so attach({ onTap }) would
      // work here now.
      //
      // Keeping click anyway: opening a bout is this screen's primary action,
      // a click listener is the simplest thing that can possibly work, and
      // attach() is already on this row for the swipe-to-delete — so the tap
      // path would be the only reason to route a second concern through it.
      // attach() suppresses the synthetic click after a swipe, so the two do
      // not collide.
      this.listen(row, 'click', () => {
        // Unfinished bouts reopen exactly where they were left — score,
        // cards and clock all restore. Finished ones do nothing for now.
        if (row.dataset.status === 'complete') return;
        navigate(`/bout/${id}/capture`);
      });
      this.listen(row, 'keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (row.dataset.status === 'complete') return;
        navigate(`/bout/${id}/capture`);
      });

      const cleanup = Gestures.attach(row, {
        onSwipe: e => {
          if (e.direction === 'left') {
            this._pendingDeleteId = id;
            this.shadowRoot.querySelector('#delete-confirm-modal').show();
          }
        },
      });
      this._gestureCleanups.push(cleanup);
    });
  }
}

customElements.define('home-page', HomePage);
