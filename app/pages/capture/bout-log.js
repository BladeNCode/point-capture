// The bout log: event list in, HTML out. Pure — no DOM, no store, no `this`.
//
// Extracted from capture-page.js so the transformation can be tested directly
// rather than through a mounted component, and so _renderLog() is left with
// only the DOM wiring it is actually responsible for.
//
// NOT promoted to fencing-shared yet, deliberately. Pret Compet will want a
// bout log too, but this one resolves app-level string keys (side.A/side.B,
// capture.row.*) and uses the emoji card marks, which are this app's
// presentation choices. Promoting it now would drag those into the shared
// table and guess at what a second app wants — the same mistake the shared
// reducer made by generalising from one consumer. Move it when a second app
// actually needs it.
import { t } from '../../../_lib/core/strings.js';
import { escapeHtml, sideName, clockStampText, cardInline, cardMark } from './format.js';

// A VOIDED ROW SHOWS NO SCORE. Who and when, struck through, and nothing else.
//
// It used to show the score the touch held while it counted, which is the
// truthful value for that one row and unreadable as a column. Non-contiguous
// voids freeze each struck row at a different moment, so the numbers down the
// log are ordered by when each touch was VOIDED while the rows themselves are
// ordered by when each touch HAPPENED — two sequences interleaved in one
// column. A real bout produced:
//
//     ~~Red 3-4~~   frozen 3rd
//     ~~Red 4-4~~   frozen 1st  <- the high-water mark, stranded mid-list
//     ~~Red 3-3~~   frozen 4th
//     ~~Green 4-2~~ frozen 2nd
//       Green 3-2   live
//
// which cannot be read as a tally because it is not one. The number on a
// struck row answers a question nobody asks — what the board said at an
// instant since undone — while corrupting the one everybody asks. The live
// rows alone are a valid sequence, and now they are the only scores shown.
//
// The fold still freezes scoreAfter on a voided touch (see
// fencing-shared/schema/bout.js). That is now about the stored value being
// correct for exports and future consumers, not about display.
const whoLabel = (side, score, voided) => (voided
  ? t('capture.row.touch.voided', { fencer: sideName(side) })
  : t('capture.row.touch', { fencer: sideName(side), score }));

function touchRow(touch, showPeriod) {
  // Scores are sanitized to integers by the shared reducer, but coerce again
  // here so this template doesn't depend on that to be safe.
  const a = Number(touch.scoreAfter?.A ?? 0);
  const b = Number(touch.scoreAfter?.B ?? 0);
  // No "valid" any more: the score on the left already says the touch
  // counted, so that column is better spent on when it happened.
  return `
    <li class="log-row ${touch.voided ? 'voided' : ''}" data-kind="touch" data-event-id="${escapeHtml(touch.eventId)}" data-side="${escapeHtml(touch.scoredBy)}">
      <span class="who">${escapeHtml(whoLabel(touch.scoredBy, `${a}–${b}`, touch.voided))}</span>
      <span class="detail"></span>
      <span class="at">${clockStampText(touch, showPeriod)}</span>
    </li>
  `;
}

// A red card and the point it awards are dispatched as two events (so the
// score flows through the normal touch machinery), but they are one act and
// must read — and undo — as one. Pair them here rather than leaving the
// reader to infer it from two adjacent rows.
function buildLogEntries(touches, officiating) {
  const chronological = [
    ...touches.map(touch => ({ ...touch, kind: 'touch' })),
    ...officiating,
  ].sort((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));

  const consumed = new Set();
  const items = [];

  // A touch awarded by a card belongs to that card's row and must never be
  // emitted on its own, whatever order it sorts in.
  //
  // THE BUG THIS FIXES. A red card awards a point, dispatched as a real
  // touch:scored so it flows through the normal scoring machinery. _issueCard
  // awaits the card's dispatch before dispatching the touch, and the pairing
  // below relied on that producing an earlier timestamp for the card. But
  // dispatch() stamps Date.now(), which has 1ms resolution — on a fast device
  // the awaited IDB round-trip finishes inside the same millisecond, both
  // events get the SAME occurredAt, and Array.sort is stable, so the touch
  // (spread first above) sorts ahead of its own card.
  //
  // The loop then reached the touch first, found no pairId, and pushed it as a
  // standalone row WITHOUT adding it to `consumed` — so when the card came up
  // it still matched the same touch and folded it in again. One touch, two
  // rows: the referee saw the point listed twice, once attributed to the card
  // and once bare, at an identical timestamp and score.
  //
  // CI on a fast runner found it. Pairing on cardId with no reference to order
  // removes the dependency; reordering the sort would only move the luck.
  const claimedByCard = new Set(
    chronological.filter(x => x.kind === 'touch'
      && x.awardedByCardId
      && officiating.some(o => o.kind === 'card' && o.cardId === x.awardedByCardId)),
  );

  for (let i = 0; i < chronological.length; i += 1) {
    const entry = chronological[i];
    if (consumed.has(entry)) continue;
    if (claimedByCard.has(entry)) continue;

    // A double touch is two events that happened at once — one row.
    if (entry.kind === 'touch' && entry.pairId) {
      const pair = chronological.filter(x => x.kind === 'touch' && x.pairId === entry.pairId);
      pair.forEach(x => consumed.add(x));
      items.push({ ...entry, kind: 'double', members: pair });
      continue;
    }

    // A red card and the point it awards are one act. Linked by cardId, so
    // a fencer holding several reds has each point attached to the card
    // that caused it rather than to whichever came first.
    if (entry.kind === 'card') {
      let item = entry;
      if (entry.cardType === 'red') {
        const point = chronological.find(x =>
          !consumed.has(x) && x.kind === 'touch' && x.awardedByCardId === entry.cardId);
        if (point) {
          consumed.add(point);
          item = { ...entry, kind: 'card-point', point };
        }
      }

      // Withdrawing it is not a second thing that happened — it is this
      // one, undone. Fold the revocation in so the reader sees a single
      // struck-through row rather than two they have to connect.
      const revocation = chronological.find(x =>
        !consumed.has(x) && x.kind === 'card-revoked' && x.targetCardId === entry.cardId);
      if (revocation) {
        consumed.add(revocation);
        item = { ...item, withdrawn: true };
      }

      items.push(item);
      continue;
    }

    items.push(entry);
  }

  // Newest first: the last thing that happened is what a referee is
  // checking, and it should not require scrolling to the bottom.
  return items.reverse();
}

function doubleRow(e, showPeriod) {
  const a = Number(e.scoreAfter?.A ?? 0);
  const b = Number(e.scoreAfter?.B ?? 0);
  const voided = e.members.every(m => m.voided);
  const ids = e.members.map(m => m.eventId).join(' ');
  return `
    <li class="log-row ${voided ? 'voided' : ''}" data-kind="double" data-event-ids="${escapeHtml(ids)}">
      <span class="who">${escapeHtml(voided
        ? t('capture.row.double.voided')
        : t('capture.row.double', { score: `${a}–${b}` }))}</span>
      <span class="detail"></span>
      <span class="at">${clockStampText(e, showPeriod)}</span>
    </li>
  `;
}

function cardPointRow(e, showPeriod) {
  const touch = e.point;
  const a = Number(touch.scoreAfter?.A ?? 0);
  const b = Number(touch.scoreAfter?.B ?? 0);
  // Reads like every other row: who scored and the running score on the
  // left, the reason on the right. The stripe follows the fencer who
  // *gained* the point, not the one penalised — the log is a record of the
  // score, and a green stripe on the row that put Green ahead is what a
  // referee scanning it expects.
  return `
    <li class="log-row ${touch.voided || e.withdrawn ? 'voided' : ''}" data-kind="card-point" data-side="${escapeHtml(touch.scoredBy)}" data-card-id="${escapeHtml(e.cardId ?? '')}">
      <span class="who">${escapeHtml(whoLabel(touch.scoredBy, `${a}–${b}`, touch.voided || e.withdrawn))}</span>
      <span class="detail">${escapeHtml(t('capture.row.card-for', { mark: cardMark(e.cardType), card: cardInline(e.cardType), fencer: sideName(e.against) }))}</span>
      <span class="at">${clockStampText(e, showPeriod)}</span>
    </li>
  `;
}

// Cards and timeouts share the log with touches — they're part of the same
// story and reading them in separate lists made their order guesswork.
function officiatingRow(e, showPeriod) {
  const slot = e.against ?? e.calledBy ?? '';
  const side = escapeHtml(sideName(slot));
  const card = cardInline(e.cardType);
  const mark = cardMark(e.cardType);
  const label = {
    card: t('capture.row.card', { mark, card }),
    'card-revoked': t('capture.row.card-withdrawn', { mark, card }),
    timeout: t('capture.row.timeout'),
  }[e.kind] ?? escapeHtml(e.kind ?? '');

  return `
    <li class="log-row officiating ${e.kind === 'card-revoked' || e.withdrawn ? 'voided' : ''}" data-kind="${escapeHtml(e.kind ?? '')}" data-card-id="${escapeHtml(e.cardId ?? '')}" data-card-type="${escapeHtml(e.cardType ?? '')}">
      <span class="who">${side} — ${escapeHtml(label)}</span>
      <span class="detail"></span>
      <span class="at">${clockStampText(e, showPeriod)}</span>
    </li>
  `;
}

// The Capture screen is three zones and nothing else: fencer A, fencer B,
// and the clock.
//
// Scoped to the referee persona for now: a touch is a touch, with no
// action type, piste/body location or off-target call. Those fields still
// exist in the schema and the presets that describe them are still in
// app/store/presets.js — this screen simply doesn't ask for them, because
// mid-bout a referee has no hands free for a detail sheet. The analyst and
// video-review entry paths come back as their own flows, not as branching
// inside this one.
//
// Timeouts and priority are likewise deferred rather than deleted: the
// events and reducer cases remain, only the controls are gone.
//
// Gesture contract, chosen around the real failure mode (referees forget to
// stop the clock, so stopping it must be the cheapest thing on screen):
//   tap clock          → start / halt
//   hold clock + drag  → correct the time
//   hold a half        → that fencer scores, clock halts
// Entries to markup, including the period dividers.
//
// Dividers are derived from the `period` already on each entry. Nothing is
// stored for them: a period change is not an event, and this deliberately
// does not invent one. The log is newest-first, so a period heading sits
// above its own group.
export function renderLogHtml(touches, officiating, { showPeriod }) {
  const entries = buildLogEntries(touches, officiating);
  const html = [];
  let shownPeriod = null;

  for (const e of entries) {
    const period = Number(e.period);
    if (showPeriod && Number.isFinite(period) && period !== shownPeriod) {
      shownPeriod = period;
      html.push(`<li class="log-divider" aria-hidden="true">${escapeHtml(t('capture.row.period', { period }))}</li>`);
    }
    if (e.kind === 'touch') html.push(touchRow(e, showPeriod));
    else if (e.kind === 'double') html.push(doubleRow(e, showPeriod));
    else if (e.kind === 'card-point') html.push(cardPointRow(e, showPeriod));
    else html.push(officiatingRow(e, showPeriod));
  }

  return { html: html.join(''), entryCount: entries.length };
}
