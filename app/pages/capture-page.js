import { AppElement } from '../../_lib/core/app-element.js';
import { captureStyles } from './capture/capture-page.styles.js';
import { escapeHtml, sideLabel, cardInline, CARD_TYPES } from './capture/format.js';
import { renderLogHtml } from './capture/bout-log.js';
import { Gestures } from '../../_lib/modules/gestures/gestures.js';
import { toast } from '../../_lib/modules/toast/toast.js';
import { t } from '../../_lib/core/strings.js';
import { dispatch } from '../../_lib/core/store/store.js';
import { navigate } from '../../_lib/core/router/router.js';
import { loadSoundPrefs, saveSoundPrefs, WARNING_MARKS } from '../store/sound-prefs.js';
import { uuid } from '../store/uuid.js';
import '../shared/capture/touch-target.js';
import '../shared/capture/match-timer.js';
import '../shared/capture/card-rack.js';
import '../shared/capture/card-picker.js';
import { buzz, BUZZ_CLOCK, BUZZ_SCORE } from '../shared/capture/haptics.js';
import { BOUT_COMPLETED, CARD_ISSUED, CARD_REVOKED, CLOCK_UPDATED, TOUCH_SCORED, TOUCH_VOIDED } from '../shared/vocabulary/events.js';

//   tap a half         → nothing (explains itself via a hint)
class CapturePage extends AppElement {
  template() {
    return `
      <style>${captureStyles}</style>

      <main>
        <div class="field">
          <touch-target id="tap-a" side="A"></touch-target>
          <touch-target id="tap-b" side="B"></touch-target>

          <button type="button" class="chip" id="back-btn" aria-label="${escapeHtml(t('capture.back'))}">
            <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
          <button type="button" class="chip dots" id="officiating-btn" aria-label="${escapeHtml(t('capture.actions'))}">
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </button>

          <card-rack class="rack" id="rack-a" side="A"></card-rack>
          <card-rack class="rack" id="rack-b" side="B"></card-rack>

          <touch-target id="double-btn" compact side="BOTH" label="${escapeHtml(t('capture.double'))}" hidden></touch-target>
        </div>

        <section class="deck" id="deck">
          <button type="button" class="handle" id="deck-handle" aria-expanded="false" aria-controls="log-pane" aria-label="${escapeHtml(t('capture.log.show'))}">
            <svg viewBox="0 0 40 10" aria-hidden="true"><path d="M3 7l17-4 17 4"/></svg>
          </button>
          <match-timer id="match-timer">
            <button type="button" slot="action" id="complete-icon-btn" aria-label="${escapeHtml(t('capture.end-bout'))}" hidden>
              <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
            </button>
            <button type="button" slot="action-start" class="period-btn" id="next-period-btn" aria-label="${escapeHtml(t('capture.next-period'))}" hidden>
              <svg viewBox="0 0 24 24"><path d="M7 5l9 7-9 7z" fill="currentColor" stroke="none"/><rect x="17" y="5" width="2.5" height="14" rx="1" fill="currentColor" stroke="none"/></svg>
            </button>
            <button type="button" slot="action-start" class="period-btn" id="prev-period-btn" aria-label="${escapeHtml(t('capture.prev-period'))}" hidden>
              <svg viewBox="0 0 24 24"><path d="M3.5 9.5h6v-6" /><path d="M4.2 9.1a8 8 0 1 1 .6 6.1" /></svg>
            </button>
          </match-timer>
          <div class="log-wrap">
          <div class="log-pane" id="log-pane">
            <p class="log-empty" id="log-hint">${escapeHtml(t('capture.log.empty'))}</p>
            <ul id="touch-log"></ul>
            <button type="button" class="deck-action" id="complete-btn">${escapeHtml(t('capture.end-bout'))}</button>
          </div>
          </div>
        </section>
      </main>

      <card-picker id="card-picker"></card-picker>

      <modal-dialog id="officiating-modal" aria-label="${escapeHtml(t('capture.actions'))}">
        <h3>${escapeHtml(t('capture.sound.title'))}</h3>
        <label class="switch">
          <input type="checkbox" id="sound-enabled">
          <span>${escapeHtml(t('capture.sound.toggle'))}</span>
        </label>
        <label class="setting" id="sound-volume-field">
          <span>${escapeHtml(t('capture.sound.volume'))}</span>
          <input type="range" id="sound-volume" min="0" max="100" step="5">
        </label>

        <div class="setting" id="warn-field">
          <span>${escapeHtml(t('capture.sound.warn'))}</span>
          <div class="marks" id="warn-marks"></div>
        </div>

        <button slot="footer" class="primary" id="officiating-close-btn">${escapeHtml(t('capture.sound.close'))}</button>
      </modal-dialog>

      <modal-dialog id="void-confirm-modal" aria-label="${escapeHtml(t('capture.void.title'))}">
        <p id="void-confirm-prompt">${escapeHtml(t('capture.void.touch'))}</p>
        <button slot="footer" class="secondary" id="void-cancel-btn">${escapeHtml(t('capture.void.cancel'))}</button>
        <button slot="footer" class="primary" id="void-confirm-btn">${escapeHtml(t('capture.void.confirm'))}</button>
      </modal-dialog>

      <modal-dialog id="complete-confirm-modal" aria-label="${escapeHtml(t('capture.complete.title'))}">
        <p id="complete-summary">${escapeHtml(t('capture.complete.prompt'))}</p>
        <p class="priority-note">${escapeHtml(t('capture.complete.note'))}</p>
        <button slot="footer" class="secondary" id="complete-cancel-btn">${escapeHtml(t('capture.complete.cancel'))}</button>
        <button slot="footer" class="primary" id="complete-confirm-btn">${escapeHtml(t('capture.complete.confirm'))}</button>
      </modal-dialog>
    `;
  }

  subscribe() {
    const sr = this.shadowRoot;
    this._boutId = this.params?.id;
    this._pendingVoid = null;
    this._touchGestureCleanups = [];
    this._timer = sr.querySelector('#match-timer');

    this.listen(sr.querySelector('#back-btn'), 'click', () => navigate('/'));

    // Scoring: the halves and the DOUBLE pill all emit the same events, so
    // the hold-to-score contract is identical across all three.
    this.listen(sr.querySelector('#tap-a'), 'touch-score', () => this._onScore('A'));
    this.listen(sr.querySelector('#tap-b'), 'touch-score', () => this._onScore('B'));
    this.listen(sr.querySelector('#double-btn'), 'touch-score', () => this._logDouble());

    // Any tap, anywhere, stops the clock. Only the clock band can start it
    // again — so a stray touch is always safe (it can only halt, never
    // resume or score) while still doing the thing referees most often
    // forget. With the clock already halted there's nothing to stop, so the
    // tap explains how to score instead of feeling dead.
    //
    // Deliberately does NOT open cards: the scoring halves are a huge
    // target and a mis-tap throwing up a full-screen card would be far more
    // disruptive than a toast. Cards open from the rack at the top, which
    // is small and aimed at on purpose.
    const tapToHalt = () => {
      if (this._timer.running) {
        buzz(BUZZ_CLOCK); // match-timer only buzzes its own taps
        this._timer.halt();
      } else {
        toast(t('capture.hold-to-score'), 'info');
      }
    };
    this.listen(sr.querySelector('#tap-a'), 'touch-tap', tapToHalt);
    this.listen(sr.querySelector('#tap-b'), 'touch-tap', tapToHalt);
    this.listen(sr.querySelector('#double-btn'), 'touch-tap', tapToHalt);

    this.listen(this._timer, 'timer-expired', e => this._onTimerExpired(e.detail));
    this.listen(this._timer, 'timer-state', e => this._onTimerState(e.detail.running));

    this.listen(sr.querySelector('#complete-btn'), 'click', this._haltFirst(() => this._openCompleteConfirm()));
    this.listen(sr.querySelector('#complete-icon-btn'), 'click', this._haltFirst(() => this._openCompleteConfirm()));
    this.listen(sr.querySelector('#complete-cancel-btn'), 'click', () => sr.querySelector('#complete-confirm-modal').close());
    this.listen(sr.querySelector('#complete-confirm-btn'), 'click', () => this._completeBout());

    this.listen(sr.querySelector('#void-cancel-btn'), 'click', () => sr.querySelector('#void-confirm-modal').close());
    this.listen(sr.querySelector('#void-confirm-btn'), 'click', () => this._commitVoid());

    this.listen(sr.querySelector('#rack-a'), 'rack-open', () => this._openCardPicker('A'));
    this.listen(sr.querySelector('#rack-b'), 'rack-open', () => this._openCardPicker('B'));
    this.listen(sr.querySelector('#card-picker'), 'card-apply', e => this._issueCard(e.detail.side, e.detail.cardType));
    this.listen(sr.querySelector('#card-picker'), 'card-revoke', e => this._revokeCard(e.detail.side, e.detail.cardType));

    this.listen(sr.querySelector('#officiating-btn'), 'click', () => this._openOfficiating());
    this.listen(sr.querySelector('#officiating-close-btn'), 'click', () => sr.querySelector('#officiating-modal').close());
    this.listen(sr.querySelector('#next-period-btn'), 'click', this._haltFirst(() => {
      this._timer.nextPeriod();
      this._syncPeriodButtons();
      this._persistClock(false);
    }));
    this.listen(sr.querySelector('#prev-period-btn'), 'click', this._haltFirst(() => {
      this._timer.previousPeriod();
      this._syncPeriodButtons();
      this._persistClock(false);
    }));

    this._expanded = false;
    this._attachDeckDrag();
    this._guardLogWhileRunning();

    this._soundPrefs = loadSoundPrefs();
    // Marks are rendered before prefs are applied — applying them sets the
    // pressed state on these buttons, so they have to exist first.
    this._renderWarnMarks();
    this._applySoundPrefs();
    this.listen(sr.querySelector('#sound-enabled'), 'change', e => this._setSound({ enabled: e.target.checked }));
    this.listen(sr.querySelector('#sound-volume'), 'input', e => this._setSound({ volume: Number(e.target.value) / 100 }));

    this.watch('bouts', bouts => this._onBoutChange(bouts?.[this._boutId]));
    // The log interleaves touches with officiating — cards and timeouts are
    // part of the bout's story, and reading them in separate lists made the
    // order between them guesswork.
    this.watch('clockByBout', m => this._restoreClock(m?.[this._boutId]));
    this.watch('touchesByBout', m => { this._touches = m?.[this._boutId] ?? []; this._renderLog(); });
    this.watch('officiatingByBout', m => { this._officiating = m?.[this._boutId] ?? []; this._renderLog(); });

  }

  unsubscribe() {
    this._touchGestureCleanups.forEach(cleanup => cleanup());
    this._touchGestureCleanups = [];
  }

  _onBoutChange(bout) {
    if (!bout) return;
    this._bout = bout;
    const sr = this.shadowRoot;

    const scoreA = Number(bout.scoreAfter?.A ?? 0);
    const scoreB = Number(bout.scoreAfter?.B ?? 0);

    const tapA = sr.querySelector('#tap-a');
    const tapB = sr.querySelector('#tap-b');
    tapA.setAttribute('label', sideLabel(bout, 'A'));
    tapB.setAttribute('label', sideLabel(bout, 'B'));
    tapA.setAttribute('score', String(scoreA));
    tapB.setAttribute('score', String(scoreB));
    for (const side of ['A', 'B']) {
      const rack = sr.querySelector(`#rack-${side.toLowerCase()}`);
      rack.setAttribute('cards', this._cardsAttr(bout.cardCounts?.[side]));
      rack.setAttribute('label', sideLabel(bout, side));
    }

    if (bout.format?.periodLengthSeconds) this._timer.setAttribute('period-length', String(bout.format.periodLengthSeconds));
    if (bout.format?.periodCount) this._timer.setAttribute('period-count', String(bout.format.periodCount));
    this._timer.setAttribute('meta', bout.weapon ?? '');

    // Double touches only exist in épée — foil and sabre resolve
    // simultaneous hits by right of way, so one side always scores.
    sr.querySelector('#double-btn').hidden = bout.weapon !== 'epee';

    this._syncPeriodButtons();
    this._syncCompleteButton();
  }

  // Mirror the clock's state onto every other surface so the running colour
  // floods the whole screen, not just the band. Nothing moves or resizes —
  // the layout is identical in both states, and only colour carries the
  // mode (see planning doc 09: layout stability over 30+ transitions in a
  // DE bout matters more than visual novelty).
  // Advancing sits beside the clock; going back lives in the log deck.
  // Stepping forward is part of running a bout, while stepping back is a
  // correction — rare enough that it shouldn't occupy the live screen.
  // Both are driven off the bout's own period count, never a hardcoded 3.
  _syncPeriodButtons() {
    const sr = this.shadowRoot;
    const multiPeriod = this._timer.periodCount > 1;
    // On the live screen, advancing is only offered once the period has
    // actually run out — that is the only moment a referee legitimately
    // moves on, and an always-present control invites a mis-tap that skips
    // a period mid-bout. With the log open both controls are always there,
    // because that view is for corrections.
    const periodSpent = this._timer.remainingSeconds <= 0;
    sr.querySelector('#next-period-btn').hidden =
      !multiPeriod || !this._timer.canAdvancePeriod || !(this._expanded || periodSpent);
    // Stepping back is a correction, so it only surfaces with the log open
    // — the same place every other correction lives.
    sr.querySelector('#prev-period-btn').hidden =
      !multiPeriod || !this._timer.canGoBackPeriod || !this._expanded;
  }

  // The bout is *decided*, not over — the referee still has to call it, and
  // may want to void a touch or keep going. So this only offers the action;
  // it never ends anything, and the log stays open if it already is.
  _syncCompleteButton() {
    const target = Number(this._bout?.format?.targetScore) || 0;
    const { A = 0, B = 0 } = this._bout?.scoreAfter ?? {};
    const reached = target > 0 && (A >= target || B >= target);
    this.shadowRoot.querySelector('#complete-icon-btn').hidden = !reached;
  }

  // Deliberately does NOT collapse the deck when the clock starts. A
  // referee may well want the clock running while they read back the log,
  // and being thrown out of the log to restart the bout is worse than any
  // tidiness it buys.
  _onTimerState(running) {
    const sr = this.shadowRoot;
    this._persistClock(running);
    sr.querySelector('main').toggleAttribute('data-running', running);
    for (const sel of ['#tap-a', '#tap-b', '#double-btn']) {
      sr.querySelector(sel).toggleAttribute('running', running);
    }
  }

  _cardsAttr(counts) {
    const c = counts ?? {};
    return CARD_TYPES.map(type => c[type] ?? 0).join(',');
  }

  // Scoring and halting the clock are one motion — the whole reason the
  // clock owns the cheap gesture is that this coupling removes the step
  // referees were skipping.
  _onScore(side) {
    this._timer.halt();
    this._logTouch(side);
  }

  // Where on the clock an act happened — the reading the referee saw, so
  // the log can be reconciled against a video or a paper sheet later.
  _clockStamp() {
    return {
      matchClockSeconds: Math.round(this._timer.remainingSeconds),
      period: this._timer.currentPeriod,
    };
  }

  _logTouch(scoredBy) {
    const current = this._bout?.scoreAfter ?? { A: 0, B: 0 };
    dispatch(TOUCH_SCORED, {
      boutId: this._boutId,
      touchId: uuid(),
      scoredBy,
      valid: true,
      scoreAfter: { ...current, [scoredBy]: current[scoredBy] + 1 },
      ...this._clockStamp(),
    });
  }

  async _logDouble() {
    // Épée-only, and genuinely simultaneous. It is still two touch:scored
    // events (one per fencer, so the score and every consumer keep working
    // unchanged), but they share a `pairId` and an `occurredAt`, and both
    // carry the score *after both* counted. Nothing in the data says one
    // arrived first, because nothing did — see recomputeScores in the
    // shared reducer, which scores a pair atomically.
    //
    // The two dispatches are awaited in sequence: dispatch() isn't safe to
    // fire concurrently, since each reads and overwrites the shared state
    // after its own IDB write resolves.
    this._timer.halt();
    const current = this._bout?.scoreAfter ?? { A: 0, B: 0 };
    const shared = {
      boutId: this._boutId,
      valid: true,
      pairId: uuid(),
      scoreAfter: { A: current.A + 1, B: current.B + 1 },
      ...this._clockStamp(),
    };
    const at = Date.now();

    await dispatch(TOUCH_SCORED, { ...shared, touchId: uuid(), scoredBy: 'A' }, at);
    await dispatch(TOUCH_SCORED, { ...shared, touchId: uuid(), scoredBy: 'B' }, at);
  }

  _onTimerExpired({ isFinalPeriod }) {
    this._syncPeriodButtons();
    const { A = 0, B = 0 } = this._bout?.scoreAfter ?? {};
    if (isFinalPeriod && A === B) {
      // Surface the priority decision instead of expecting the referee to
      // remember to go find it in a menu (the live reference apps prompt
      // here too).
      toast(t('capture.toast.priority'), 'info');
      this._openOfficiating();
    } else if (isFinalPeriod) {
      toast(t('capture.toast.final-over'), 'info');
    } else {
      toast(t('capture.toast.period-end'), 'info');
    }
  }

  _openCompleteConfirm() {
    const { A = 0, B = 0 } = this._bout?.scoreAfter ?? {};
    this.shadowRoot.querySelector('#complete-summary').textContent =
      t('capture.complete.at', {
        a: sideLabel(this._bout, 'A'), scoreA: A, scoreB: B, b: sideLabel(this._bout, 'B'),
      });
    this.shadowRoot.querySelector('#complete-confirm-modal').show();
  }

  _completeBout() {
    this._timer.halt();
    dispatch(BOUT_COMPLETED, { boutId: this._boutId });
    this.shadowRoot.querySelector('#complete-confirm-modal').close();
    toast(t('capture.toast.complete'), 'success');
    navigate('/');
  }

  _openOfficiating() {
    this.shadowRoot.querySelector('#officiating-modal').show();
  }

  // A fencer can only hold one yellow — a second offence is a red — so once
  // yellow is spent it stops being offered at all, rather than being shown
  // and rejected. Reds and black stay available indefinitely.
  // Vertical drag on the deck handle, hand-rolled because the Gestures
  // module's swipe is horizontal-only (a vertical move cancels the gesture
  // outright) and it reports a fired-and-forgotten direction rather than a
  // live offset. Tap on the clock survives this: any movement past its tap
  // threshold cancels it, so a drag never also toggles the clock.
  _attachDeckDrag() {
    const sr = this.shadowRoot;
    const deck = sr.querySelector('#deck');
    const DRAG_THRESHOLD = 36; // px before a drag counts as a decision

    let startY = null;

    // The chevron is the visible affordance and toggles on its own.
    this.listen(sr.querySelector('#deck-handle'), 'click', () => this._setExpanded(!this._expanded));

    // Dragging works anywhere on the deck except inside the log, which
    // needs its own vertical scrolling. Because only movement past the
    // threshold counts, a plain tap still reaches whatever is underneath —
    // the clock digits, the period buttons, the End Bout control.
    this.listen(deck, 'pointerdown', e => {
      if (e.target.closest('#log-pane')) return;
      startY = e.clientY;
    });

    this.listen(deck, 'pointerup', e => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      if (Math.abs(dy) < DRAG_THRESHOLD) return; // a tap — leave it alone
      this._setExpanded(dy < 0);                 // up opens, down closes
    });

    this.listen(deck, 'pointercancel', () => { startY = null; });
  }

  // With the clock running the log is readable but not operable: a press
  // anywhere in it stops the clock and goes no further.
  //
  // Scrolling is exempt. Reading back earlier touches is exactly what the
  // log is for, so a drag must not be mistaken for a press — the decision
  // is deferred to pointerup and made on distance moved. Scrolling itself
  // is never impeded: this stops propagation (so rows and buttons beneath
  // don't act) but never calls preventDefault, and the browser scrolls on
  // touch-action, not on JS listeners.
  _guardLogWhileRunning() {
    const pane = this.shadowRoot.querySelector('#log-pane');
    const TAP_SLOP = 8; // px of movement still counted as a press

    let start = null;
    let swallowClick = false;

    this.listen(pane, 'pointerdown', e => {
      swallowClick = this._timer.running;
      if (!this._timer.running) return;
      start = { x: e.clientX, y: e.clientY };
      e.stopPropagation();
    }, true);

    this.listen(pane, 'pointerup', e => {
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      start = null;
      e.stopPropagation();
      if (moved > TAP_SLOP) return; // a scroll — leave the clock alone
      buzz(BUZZ_CLOCK);
      this._timer.halt();
    }, true);

    this.listen(pane, 'pointercancel', () => { start = null; }, true);

    // The clock is already stopped by the time this fires, so it can't ask
    // the timer — the flag records that this gesture was intercepted.
    this.listen(pane, 'click', e => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    }, true);
  }

  // Persisted on transitions only — never per tick. `running` plus the
  // event's own timestamp is enough to work out where the clock got to if
  // the page died mid-exchange.
  _persistClock(running) {
    if (!this._boutId || !this._timer) return;
    dispatch(CLOCK_UPDATED, {
      boutId: this._boutId,
      period: this._timer.currentPeriod,
      remainingSeconds: Math.round(this._timer.remainingSeconds),
      running,
    });
  }

  // Restore once, on arrival. If the clock was left running we subtract the
  // real time that passed, because it genuinely did — but only up to one
  // period's worth: beyond that the bout was abandoned rather than
  // refereed, and draining it to 0:00 would be worse than leaving it where
  // it was last known good.
  _restoreClock(saved) {
    // Strictly one-shot. The watch fires immediately on subscribe (after
    // boot has replayed every event, so saved state is already there), and
    // again on each clock:updated this page dispatches itself — without
    // the latch, persisting a start would immediately restore-and-halt it.
    if (this._clockRestored) return;
    this._clockRestored = true;
    if (!saved) return;

    let remainingSeconds = saved.remainingSeconds;
    if (saved.running && Number.isFinite(saved.at)) {
      const elapsed = (Date.now() - saved.at) / 1000;
      const periodLength = Number(this._bout?.format?.periodLengthSeconds) || 180;
      if (elapsed >= 0 && elapsed <= periodLength) {
        remainingSeconds = Math.max(0, remainingSeconds - elapsed);
      }
    }
    this._timer.restore({ period: saved.period, remainingSeconds });
    this._syncPeriodButtons();
  }

  // Period and End Bout do nothing but stop the clock while it runs.
  // Nobody changes period or ends a bout mid-exchange, so treating the
  // press as "halt" costs nothing and removes a whole class of mistake.
  _haltFirst(action) {
    return () => {
      if (this._timer.running) {
        buzz(BUZZ_CLOCK);
        this._timer.halt();
        return;
      }
      action();
    };
  }

  _setExpanded(expanded) {
    this._expanded = expanded;
    const sr = this.shadowRoot;
    sr.querySelector('main').toggleAttribute('data-expanded', expanded);
    // "DOUBLE" is too long for the compressed strip; the gesture is
    // unchanged, only the label.
    sr.querySelector('#double-btn').setAttribute('label', t(expanded ? 'capture.double.short' : 'capture.double'));
    this._syncPeriodButtons();
    const handle = sr.querySelector('#deck-handle');
    handle.setAttribute('aria-expanded', String(expanded));
    handle.setAttribute('aria-label', t(expanded ? 'capture.log.hide' : 'capture.log.show'));
  }

  _renderWarnMarks() {
    const container = this.shadowRoot.querySelector('#warn-marks');
    container.innerHTML = WARNING_MARKS
      .map(mark => `<button type="button" data-mark="${mark}">${mark < 60 ? `${mark}s` : '1 min'}</button>`)
      .join('');
    for (const btn of container.querySelectorAll('button')) {
      this.listen(btn, 'click', () => {
        const mark = Number(btn.dataset.mark);
        const current = this._soundPrefs.warnAt ?? [];
        const warnAt = current.includes(mark)
          ? current.filter(m => m !== mark)
          : [...current, mark];
        this._setSound({ warnAt });
      });
    }
  }

  _applySoundPrefs() {
    const sr = this.shadowRoot;
    const { enabled, volume, warnAt } = this._soundPrefs;
    this._timer.soundEnabled = enabled;
    this._timer.soundVolume = volume;
    this._timer.warnAt = warnAt;
    for (const btn of sr.querySelectorAll('#warn-marks button')) {
      btn.setAttribute('aria-pressed', String((warnAt ?? []).includes(Number(btn.dataset.mark))));
    }
    sr.querySelector('#warn-field').hidden = !enabled;
    sr.querySelector('#sound-enabled').checked = enabled;
    sr.querySelector('#sound-volume').value = String(Math.round(volume * 100));
    // Volume is meaningless while muted — hidden rather than disabled so the
    // sheet doesn't show a control that looks broken.
    sr.querySelector('#sound-volume-field').hidden = !enabled;
  }

  _setSound(patch) {
    this._soundPrefs = saveSoundPrefs({ ...this._soundPrefs, ...patch });
    this._applySoundPrefs();
  }

  _openCardPicker(side) {
    // A card is always called at halt. Stopping the clock here means the
    // referee doesn't have to remember to do it before reaching for the
    // rack — and leaving it running behind a full-screen picker would be
    // the worst possible failure.
    if (this._timer.running) {
      buzz(BUZZ_CLOCK);
      this._timer.halt();
    }
    const counts = this._bout?.cardCounts?.[side] ?? {};
    // A fencer holds at most one yellow — a second offence is a red — so
    // once it's spent the deck is just red and black, and the picker opens
    // straight onto red rather than on a card that can't be given.
    const options = CARD_TYPES.filter(type => !(type === 'yellow' && (counts.yellow ?? 0) > 0));
    this.shadowRoot.querySelector('#card-picker').open({
      side,
      label: sideLabel(this._bout, side),
      options,
      counts,
    });
  }

  async _issueCard(against, cardType) {
    // Fired before any await: vibration has to follow the interaction, and
    // after two awaited IDB round-trips this is no longer obviously part of
    // the gesture. A red awards a point, so it gets the scoring pulse — the
    // same signal the referee feels scoring one by hand. Other cards get
    // the short pulse: something happened, but nothing reached the board.
    buzz(cardType === 'red' ? BUZZ_SCORE : BUZZ_CLOCK);

    // Its own identity, so the point it awards and any later withdrawal
    // can name this exact card. (side, cardType) stops being unique the
    // moment a fencer holds two reds.
    const cardId = uuid();
    await dispatch(CARD_ISSUED, {
      boutId: this._boutId, against, cardType, cardId, ...this._clockStamp(),
    });

    // A red card awards the opponent a point. Recording that as a real
    // touch:scored (flagged with how it was awarded) rather than a special
    // case in the reducer means it flows through the existing scoring
    // machinery for free — running score, the touch log, and voiding all
    // behave correctly, and the audit trail keeps both events.
    if (cardType === 'red') {
      const opponent = against === 'A' ? 'B' : 'A';
      const current = this._bout?.scoreAfter ?? { A: 0, B: 0 };
      await dispatch(TOUCH_SCORED, {
        boutId: this._boutId,
        touchId: uuid(),
        scoredBy: opponent,
        valid: true,
        scoreAfter: { ...current, [opponent]: current[opponent] + 1 },
        awardedBy: 'red-card',
        awardedByCardId: cardId,
        ...this._clockStamp(),
      });
    }

    toast(t('capture.toast.card', { card: cardInline(cardType), fencer: sideLabel(this._bout, against) }), 'info');
  }

  async _revokeCard(cardId) {
    const card = (this._officiating ?? []).find(e => e.kind === 'card' && e.cardId === cardId);
    if (!card) return;
    const { against, cardType } = card;

    await dispatch(CARD_REVOKED, {
      boutId: this._boutId, against, cardType, targetCardId: cardId, ...this._clockStamp(),
    });

    // A red's point lives as its own touch:scored, so withdrawing the card
    // has to void that touch too or the score keeps a point nobody holds a
    // card for. Void *that card's* point specifically — picking "the most
    // recent red-card point" struck the wrong touch whenever a fencer held
    // more than one red.
    if (cardType === 'red') {
      const target = (this._touches ?? [])
        .find(touch => !touch.voided && touch.awardedByCardId === cardId);
      if (target) {
        await dispatch(TOUCH_VOIDED, {
          boutId: this._boutId,
          targetEventId: target.eventId,
          reason: 'red card withdrawn',
        });
      }
    }

    toast(t('capture.toast.card-revoked', { card: cardInline(cardType), fencer: sideLabel(this._bout, against) }), 'info');
  }

  async _voidAll(eventIds) {
    for (const targetEventId of eventIds) {
      await dispatch(TOUCH_VOIDED, {
        boutId: this._boutId, targetEventId, reason: 'double touch voided',
      });
    }
  }

  _renderLog() {
    const touches = this._touches ?? [];
    const officiating = this._officiating ?? [];

    // Same Phase-1 simplification as Home: swipe directly opens the void
    // confirm modal rather than a two-step reveal-then-tap interaction.
    this._touchGestureCleanups.forEach(cleanup => cleanup());
    this._touchGestureCleanups = [];

    const list = this.shadowRoot.querySelector('#touch-log');
    const hint = this.shadowRoot.querySelector('#log-hint');

    // One period means the clock never restarts, so the period number adds
    // nothing to a timestamp.
    const showPeriod = (this._timer?.periodCount ?? 1) > 1;
    const { html, entryCount } = renderLogHtml(touches, officiating, { showPeriod });

    if (hint) hint.textContent = t(entryCount ? 'capture.log.hint' : 'capture.log.empty');
    list.innerHTML = html;

    [...list.querySelectorAll('.log-row')].forEach(row => {
      if (row.classList.contains('voided')) return;
      const kind = row.dataset.kind;
      if (!['touch', 'card-point', 'double', 'card'].includes(kind)) return;
      // A card already withdrawn has nothing left to undo.
      if (row.classList.contains('voided')) return;
      const pending =
        kind === 'card-point' || kind === 'card'
          ? { kind: 'card', cardId: row.dataset.cardId, cardType: row.dataset.cardType }
          : kind === 'double'
            ? { kind, eventIds: row.dataset.eventIds.split(' ') }
            : { kind, eventId: row.dataset.eventId };
      const cleanup = Gestures.attach(row, {
        onSwipe: e => {
          if (e.direction === 'left') {
            this._pendingVoid = pending;
            this.shadowRoot.querySelector('#void-confirm-prompt').textContent =
              t({ 'card-point': 'capture.void.card-point', card: 'capture.void.card', double: 'capture.void.double' }[kind]
                ?? 'capture.void.touch');
            this.shadowRoot.querySelector('#void-confirm-modal').show();
          }
        },
      });
      this._touchGestureCleanups.push(cleanup);
    });
  }

  _commitVoid() {
    const pending = this._pendingVoid;
    this._pendingVoid = null;
    this.shadowRoot.querySelector('#void-confirm-modal').close();
    if (!pending) return;

    if (pending.kind === 'card') {
      // One act, one undo: _revokeCard withdraws this exact card and, for a
      // red, voids the point it awarded.
      this._revokeCard(pending.cardId);
      return;
    }
    if (pending.kind === 'double') {
      // Both halves go together — a half-voided double is not a thing.
      this._voidAll(pending.eventIds);
      return;
    }
    dispatch(TOUCH_VOIDED, {
      boutId: this._boutId,
      targetEventId: pending.eventId,
      reason: 'user voided from Capture',
    });
  }
}

customElements.define('capture-page', CapturePage);
