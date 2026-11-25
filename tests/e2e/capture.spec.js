import { test, expect } from '@playwright/test';

const ROUTER = `document.querySelector('app-router')?.shadowRoot`;
const CAPTURE = `${ROUTER}?.querySelector('capture-page')?.shadowRoot`;

async function startBout(page) {
  await page.goto('/');
  await page.waitForFunction(`!!${ROUTER}?.querySelector('home-page')?.shadowRoot`);
  await page.evaluate(() => {
    const hp = document.querySelector('app-router').shadowRoot
      .querySelector('home-page').shadowRoot;
    hp.querySelector('#new-bout-btn').click();
    hp.querySelector('#start-btn').click();
  });
  await page.waitForFunction(`!!${CAPTURE}?.querySelector('#tap-a')`);
  await page.waitForTimeout(250);
}

test.describe('Capture screen', () => {
  // Regression guard for a cascade trap that is invisible to unit tests:
  // AppElement applies its base sheet via adoptedStyleSheets, which the
  // cascade orders *after* each component's own <style>. A bare
  // `:host { display: none }` therefore loses to base's `display: block`,
  // and card-picker — fixed, inset 0, z-index 100 — silently covered the
  // entire app on every new bout. happy-dom doesn't resolve :host rules
  // into computed style, so only a real browser can catch this.
  test('a new bout shows the fencers, not a full-screen overlay', async ({ page }) => {
    await startBout(page);

    const state = await page.evaluate(`(() => {
      const sr = ${CAPTURE};
      const picker = sr.querySelector('#card-picker');
      return {
        pickerDisplay: getComputedStyle(picker).display,
        pickerOpen: picker.hasAttribute('open'),
        halvesVisible: ['#tap-a', '#tap-b'].every(s => sr.querySelector(s).getBoundingClientRect().height > 100),
        clockVisible: sr.querySelector('#match-timer').getBoundingClientRect().height > 50,
      };
    })()`);

    expect(state.pickerOpen).toBe(false);
    expect(state.pickerDisplay).toBe('none');
    expect(state.halvesVisible).toBe(true);
    expect(state.clockVisible).toBe(true);
  });

  test('the rack opens the card picker, and cancel restores the screen', async ({ page }) => {
    await startBout(page);

    await page.evaluate(`${CAPTURE}.querySelector('#rack-a').shadowRoot.querySelector('#btn').click()`);
    await page.waitForTimeout(300);
    expect(await page.evaluate(`getComputedStyle(${CAPTURE}.querySelector('#card-picker')).display`)).toBe('flex');

    await page.evaluate(`${CAPTURE}.querySelector('#card-picker').shadowRoot.querySelector('#cancel').click()`);
    await page.waitForTimeout(300);
    expect(await page.evaluate(`getComputedStyle(${CAPTURE}.querySelector('#card-picker')).display`)).toBe('none');
  });
});
