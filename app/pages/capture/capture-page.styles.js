// The Capture screen's stylesheet, lifted out of capture-page.js verbatim.
//
// It was 449 lines inside a 531-line template(), which meant the markup — the
// part you actually come to template() to read — was buried past four screens
// of CSS. Moving it changes nothing about how it is applied: still one <style>
// element in the component's shadow root, still scoped to it, still a single
// string with no runtime cost.
//
// Kept as a plain exported string rather than a CSSStyleSheet so the component
// keeps interpolating it into template() exactly as before. Adopting it as a
// constructable sheet instead would change the cascade order relative to
// Socle's base sheet, which is the trap documented in touch-target,
// match-timer and card-picker — not worth re-opening to save an interpolation.
export const captureStyles = `
        :host { display: block; }
        main {
          display: flex;
          flex-direction: column;
          block-size: 100dvh;
        }
        .field {
          flex: 1;
          min-block-size: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          position: relative;
        }
        .field::after {
          content: '';
          position: absolute;
          inset-block: 0;
          inset-inline-start: 50%;
          inline-size: 2px;
          background: rgba(255,255,255,0.22);
          transform: translateX(-1px);
          pointer-events: none;
          z-index: 2;
        }
        /* While the clock runs, both halves are one colour — a bright seam
           would contradict that, so it fades to a hairline rather than
           disappearing (removing it would be a layout change). */
        main[data-running] .field::after { background: rgba(255,255,255,0.07); }
        @media (prefers-reduced-motion: no-preference) {
          .field::after { transition: background 300ms cubic-bezier(0.05, 0.7, 0.1, 1); }
        }
        .chip {
          position: absolute;
          inset-block-start: calc(var(--space-3) + var(--safe-area-top, 0px));
          inline-size: 30px;
          block-size: 30px;
          border-radius: var(--radius-full);
          background: rgba(0,0,0,0.3);
          border: 1.5px solid rgba(255,255,255,0.45);
          color: var(--color-field-ink, #fff);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 5;
        }
        .chip svg { inline-size: 15px; block-size: 15px; stroke: currentColor; fill: none; stroke-width: 2.2; }
        .chip.dots svg { fill: currentColor; stroke: none; }
        #back-btn { inset-inline-start: var(--space-3); }
        #officiating-btn { inset-inline-end: var(--space-3); }

        /* The racks sit visually inside each fencer's half but are siblings
           of the touch-targets, not children — see card-rack.js for why
           (nested interactive roles, and pointer events leaking into the
           scoring gestures). Positioned over the centre of each half. */
        .rack {
          position: absolute;
          inset-block-start: calc(var(--space-4) + var(--safe-area-top, 0px));
          transform: translateX(-50%);
          z-index: 5;
        }
        #rack-a { inset-inline-start: 25%; }
        #rack-b { inset-inline-start: 75%; }
        /* Penalties are history, not the live task — while the clock runs
           they recede with everything else that isn't the time. */
        main[data-running] .rack { opacity: 0.45; }
        @media (prefers-reduced-motion: no-preference) {
          .rack { transition: opacity 240ms linear; }
        }
        @media (max-height: 600px) {
          .rack { inset-block-start: calc(var(--space-2) + var(--safe-area-top, 0px)); }
        }

        #double-btn {
          position: absolute;
          inset-inline-start: 50%;
          inset-block-end: var(--space-3);
          transform: translateX(-50%);
          z-index: 4;
        }
        #double-btn[hidden] { display: none; }

        /* Icon alone — an outline made a rare, secondary action look as
           weighty as the clock it sits beside. */
        .period-btn {
          inline-size: 40px;
          block-size: 40px;
          border: none;
          background: none;
          padding: 0;
          color: var(--color-field-ink, #fff);
          opacity: 0.7;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        /* With the log open the column can hold one button or two, so both
           slots stay reserved and neither shifts as they come and go.
           visibility (not display) keeps the height fixed while still
           removing the hidden one from the accessibility tree.

           No !important needed any more. Socle's base sheet used to carry
           [hidden] { display: none !important }, which no plain declaration
           could beat at any specificity. Since 1.4.2 it is a bare
           [hidden] { display: none } at (0,1,0), and this selector is
           (0,3,1), so it simply wins.

           Closed, only ever one button can show, so it simply centres on
           the clock instead of sitting in a reserved two-slot column. */
        main[data-expanded] .period-btn[hidden] {
          display: flex;
          visibility: hidden;
        }
        .period-btn svg { inline-size: 20px; block-size: 20px; }
        /* The undo-style arrow is drawn, not filled like the skip glyphs. */
        #prev-period-btn svg { stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .period-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: var(--radius-sm); }

        /* Ending a bout lives in the log deck, not under the thumb. It is a
           once-per-bout, hard-to-undo action, and the bottom-right corner
           of a phone held one-handed is the single worst place for it —
           that corner belongs to scoring. Here it is labelled, full width,
           and only reachable after deliberately opening the deck. */
        #complete-icon-btn {
          inline-size: 40px;
          block-size: 40px;
          border: none;
          background: none;
          padding: 0;
          color: var(--color-field-ink, #fff);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        #complete-icon-btn[hidden] { display: none; }
        #complete-icon-btn svg { inline-size: 22px; block-size: 22px; stroke: currentColor; fill: none; stroke-width: 2.4; }
        #complete-icon-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: var(--radius-sm); }

        .deck-action {
          inline-size: 100%;
          margin-block-start: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-md);
          border: 1.5px solid rgba(255,255,255,0.35);
          background: none;
          color: var(--color-field-ink, #fff);
          font-family: var(--font-family);
          font-size: var(--font-size-body);
          font-weight: var(--font-weight-bold);
          min-block-size: var(--touch-target-lg);
          cursor: pointer;
        }
        .deck-action[hidden] { display: none; }
        #complete-btn { margin-block-start: var(--space-5); }

        .switch { display: flex; align-items: center; gap: var(--space-3); margin-block-end: var(--space-3); font-size: var(--font-size-body); }
        .switch input { inline-size: 22px; block-size: 22px; flex-shrink: 0; accent-color: var(--color-accent); }
        .setting { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--font-size-caption); color: var(--color-text-secondary); }
        .setting input[type="range"] { inline-size: 100%; accent-color: var(--color-accent); }
        .setting[hidden] { display: none; }
        .marks { display: flex; gap: var(--space-2); }
        .marks button {
          flex: 1;
          min-block-size: var(--touch-target);
          border-radius: var(--radius-md);
          border: 1px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text-primary);
          font-family: var(--font-family);
          font-size: var(--font-size-caption);
          cursor: pointer;
        }
        .marks button[aria-pressed="true"] {
          border-color: var(--color-accent);
          background: var(--color-accent-subtle);
          font-weight: var(--font-weight-bold);
        }

        /* The clock sits in a deck that can be pulled up over the fencers
           to reveal the bout log. Only the colour field shrinks — the deck
           itself is never taller than it needs to be, and the log takes
           whatever is left. */
        .deck {
          touch-action: none;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          min-block-size: 0;
          position: relative;
          background: var(--color-clock-field-end, #0B0D0F);
        }
        main[data-expanded] .deck { flex: 1; }
        /* The log is part of the screen the flood takes over: with the deck
           open the clock band is small, and a dark log beneath it would be
           the largest thing in view while the clock ran.
           It *wipes down* from the clock band, mirroring the halves wiping
           up into it — so the colour reads as spreading out from the clock
           in both directions. A crossfade here, next to a wipe above, was
           what made the whole thing look laggy. */
        /* The wipe lives on a wrapper around the log, not on the deck: the
           deck starts at the *top* of the clock band, so a wipe anchored
           there spent its first stretch hidden behind the band and the log
           appeared to start ahead of it. Anchored here it begins exactly at
           the band's lower edge — the same instant and the same seam the
           halves start from above. The band lights up as the source; the
           colour leaves it in both directions at once. */
        .log-wrap {
          flex: 1;
          min-block-size: 0;
          position: relative;
          display: none;
        }
        main[data-expanded] .log-wrap { display: block; }
        .log-wrap::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 0;
          background: var(--color-clock-active-end, #3B1F73);
          clip-path: inset(0 0 100% 0);
          pointer-events: none;
        }
        main[data-running] .log-wrap::before { clip-path: inset(0 0 0 0); }

        @media (prefers-reduced-motion: no-preference) {
          /* Held back by the clock band's own fade (140ms) — that is how
             long the colour takes to reach the band's lower edge, which is
             where this wipe begins. Waiting a full 300ms (the halves' wipe
             length) was far too long: the halves travel *away* from the
             band, so their duration says nothing about when the colour
             arrives at the other side of it.
             Safe as a constant because the fade is a fixed duration, not a
             distance.
             No delay on the way out: scoring halts the clock, and the
             referee should see that register immediately. */
          /* The colour moves in two steps, reversed on the way out, so it
             always travels *through* the screen rather than appearing on
             all of it at once:
               in   — clock band + fencers, then the log
               out  — the log, then clock band + fencers
             Both steps are the same short length: filling announces, but
             clearing is feedback for a halt the referee just caused, and
             neither should feel like an animation being waited on. */
          .log-wrap::before { transition: clip-path 150ms linear 0ms; }
          main[data-running] .log-wrap::before { transition-delay: 150ms; }
        }

        /* A very flat chevron rather than a pill — it has to read as
           "pull this up" to someone who has never used the app, which a
           featureless bar doesn't. No background band: the extra edge put
           a second line right under the score strip. */
        /* Just the chevron. The drag itself is handled on the whole deck
           (see _attachDeckDrag) rather than by an overlay: an overlay big
           enough to swipe on would also cover the clock digits and the
           period buttons, and a drag is distinguishable from a tap by
           movement alone — so everything underneath stays tappable. */
        .handle {
          position: absolute;
          inset-inline-start: 50%;
          inset-block-start: 0;
          transform: translateX(-50%);
          z-index: 3;
          border: none;
          background: none;
          padding: var(--space-2) var(--space-6);
          cursor: grab;
          touch-action: none;
          display: flex;
          justify-content: center;
        }
        /* Push the weapon/period line clear of the pull chevron, which
           overlays this area when the deck is open. */
        main[data-expanded] #match-timer { --band-pad-top: var(--space-8); }
        .handle svg { inline-size: 40px; block-size: 10px; stroke: rgba(255,255,255,0.45); fill: none; stroke-width: 2; stroke-linecap: round; }
        main[data-expanded] .handle svg { transform: rotate(180deg); }
        @media (prefers-reduced-motion: no-preference) {
          .handle svg { transition: transform 220ms cubic-bezier(0.05, 0.7, 0.1, 1); }
        }
        .handle:focus-visible { outline: 2px solid var(--color-field-ink, #fff); outline-offset: -4px; }

        .log-pane {
          position: absolute;
          inset: 0;
          z-index: 1;
          overflow-y: auto;
          /* The log scrolls normally and keeps its own overscroll to
             itself, so reaching its end never bubbles out to the page. */
          touch-action: pan-y;
          overscroll-behavior: contain;
          padding: var(--space-3) var(--space-4);
          padding-block-end: calc(var(--space-4) + var(--safe-area-bottom, 0px));
        }


        /* Expanded: the fencers compress to a strip roughly where the card
           racks sat, the clock gives up most of its size, and what's left
           is log. Nothing is hidden that the referee still needs. */
        main[data-expanded] .field { flex: 0 0 76px; }
        main[data-expanded] touch-target { --score-size: 1.85rem; }
        main[data-expanded] .rack { display: none; }
        /* The double control stays reachable with the log open — épée bouts
           are exactly when a referee is checking the log mid-bout. Same
           element and same hold-to-score gesture, just reduced to a "+"
           that fits the compressed strip. */
        main[data-expanded] #double-btn {
          inset-block-end: auto;
          inset-block-start: 50%;
          transform: translate(-50%, -50%);
          min-block-size: 34px;
          padding-inline: var(--space-4);
        }
        main[data-expanded] #match-timer { --clock-size: 2rem; --band-min: 0px; }

        @media (prefers-reduced-motion: no-preference) {
          .field { transition: flex-basis 260ms cubic-bezier(0.05, 0.7, 0.1, 1); }
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

        h3 {
          font-size: var(--font-size-caption);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-text-secondary);
          margin-block: var(--space-3) var(--space-2);
        }
        h3:first-child { margin-block-start: 0; }

        ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .log-row {
          display: flex;
          justify-content: space-between;
          background: rgba(255,255,255,0.06);
          color: var(--color-field-ink, #fff);
          border-radius: var(--radius-md);
          border-inline-start: 4px solid var(--color-border);
          padding: var(--space-2) var(--space-3);
          font-size: var(--font-size-body);
          touch-action: pan-y;
          gap: var(--space-2);
          align-items: baseline;
        }
        .log-row[data-kind="double"] {
          border-inline-start-color: transparent;
          position: relative;
          overflow: hidden;
        }
        .log-row[data-kind="double"]::before {
          content: '';
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          inline-size: 4px;
          background: linear-gradient(180deg, var(--color-side-a) 50%, var(--color-side-b) 50%);
        }
        .log-row[data-side="A"] { border-inline-start-color: var(--color-side-a); }
        .log-row[data-side="B"] { border-inline-start-color: var(--color-side-b); }
        /* No fencer colour on a row that awarded nobody a point — a green
           stripe beside a yellow card reads as something good for Green.
           Only the red card, which does award a point, is coloured (for the
           fencer who gained it). */
        .log-row.officiating { border-inline-start-color: transparent; }
        .log-row.voided { opacity: 0.5; text-decoration: line-through; }
        .log-row .who { flex: 1; min-inline-size: 0; }
        .log-row .detail { color: rgba(255,255,255,0.55); font-size: var(--font-size-caption); }
        /* Fixed column so the times line up down the list rather than
           drifting with the length of the reason beside them. */
        .log-row .at {
          color: rgba(255,255,255,0.45);
          font-size: var(--font-size-caption);
          font-variant-numeric: tabular-nums;
          inline-size: 4.6em;
          text-align: end;
          flex-shrink: 0;
        }
        .log-empty { color: rgba(255,255,255,0.5); font-size: var(--font-size-caption); text-align: center; }
        .log-divider {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-block-start: var(--space-2);
          color: rgba(255,255,255,0.45);
          font-size: var(--font-size-micro);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .log-divider::after {
          content: '';
          flex: 1;
          block-size: 1px;
          background: rgba(255,255,255,0.14);
        }
        .log-divider:first-child { margin-block-start: 0; }

        .chip-group { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block-end: var(--space-3); }
        .chip-group button {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-full);
          border: 1px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text-primary);
          font-family: var(--font-family);
          font-size: var(--font-size-caption);
          cursor: pointer;
        }
        .chip-group button[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent-subtle); font-weight: var(--font-weight-bold); }

        .officiating-columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
        .officiating-columns h4 { text-align: center; font-size: var(--font-size-body); margin-block-end: var(--space-2); }
        .stack { display: flex; flex-direction: column; gap: var(--space-2); }
        .row { display: flex; gap: var(--space-2); }
        .row button { flex: 1; }
        button.card-yellow { background: #E8B923; color: #1a1a1a; border: none; }
        button.card-red { background: #E5382F; color: #fff; border: none; }
        button.card-black { background: #1a1a1a; color: #fff; border: none; }
        .priority-note { color: var(--color-text-secondary); font-size: var(--font-size-caption); }
`;
