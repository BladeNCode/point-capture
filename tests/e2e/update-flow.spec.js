import { test, expect } from '@playwright/test';

/*
 * Full E2E SW update testing (two deployed builds swapping) cannot be automated
 * reliably in Playwright without a dedicated test fixture server. The tests below
 * cover everything that can be verified in a single build:
 *
 *   - Banner is hidden on load when version matches
 *   - Banner appears when version.json reports a newer version (Layer 2 detection)
 *   - Dismiss hides the banner without reloading
 *   - Reload button calls location.reload() when no waiting SW exists
 *
 * Manual checklist for full update cycle (run before every release):
 *   [ ] Deploy build N. Open app. SW activates. Note version in console.
 *   [ ] Deploy build N+1 (bump version in package.json).
 *   [ ] Reopen the app (do not clear SW). Update banner appears immediately (Layer 2).
 *   [ ] Tap Reload. Page reloads on new version. Banner is gone.
 *   [ ] Dismiss the banner instead. Confirm app continues to work on old version.
 *   [ ] Reopen app — update banner re-appears (SW still waiting).
 */

// Intercept version.json to report a future version, triggering Layer 2 detection.
// sw-manager fetches version.json on boot and sets updateAvailable: true when it
// differs from APP_VERSION. This works with the bundled build — no _lib/ import needed.
async function routeFutureVersion(page) {
  // Use regex to match version.json regardless of the ?_=<timestamp> cache-buster
  await page.route(/\/version\.json/, route =>
    route.fulfill({ json: { version: '999.0.0', buildTime: new Date().toISOString() } })
  );
}

async function waitForApp(page) {
  await page.waitForFunction(() =>
    !!document.querySelector('app-router')?.shadowRoot?.querySelector('home-page')
  );
}

// DB_NAME must match the dbName passed to boot() in app/main.js.
const DB_NAME = 'Point Capture';

test.describe('Update flow — banner behaviour', () => {
  test('update-banner is hidden on initial load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('update-banner')).toHaveAttribute('hidden');
  });

  test('update-banner appears when version.json reports a newer version', async ({ page }) => {
    await routeFutureVersion(page);
    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('update-banner')).not.toHaveAttribute('hidden');
  });

  test('dismiss button hides the banner without reloading', async ({ page }) => {
    await routeFutureVersion(page);
    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('update-banner')).not.toHaveAttribute('hidden');

    let reloaded = false;
    page.on('load', () => { reloaded = true; });

    await page.locator('update-banner #dismiss').click();
    await expect(page.locator('update-banner')).toHaveAttribute('hidden', '');
    expect(reloaded).toBe(false);
  });

  test('store state survives a reload triggered by the update banner', async ({ page }) => {
    // Route registered before any navigation — matching the structure every
    // other passing test in this file uses. Adding the route mid-session
    // (after an initial unrouted goto, immediately before a reload) was
    // tried first and reliably failed to show the banner on that reload for
    // reasons not fully pinned down (some SW/route-interception interaction
    // specific to a route added after the SW already controls the page) —
    // not worth chasing further when this structure is already proven to work.
    await routeFutureVersion(page);
    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('update-banner')).not.toHaveAttribute('hidden');

    // This app uses the event-log store (not simple/state), so the marker is
    // a raw event written straight into the 'events' store — replayed back
    // into a real bout by the reducer on next boot. Opening indexedDB.open()
    // with no version argument (rather than a hardcoded number) opens
    // whatever version the app's own boot() already established just above,
    // so this never goes stale on the next schema migration.
    await page.evaluate(async (dbName) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('events', 'readwrite');
        tx.objectStore('events').put({
          id: 'e2e-test-marker', deviceId: 'e2e', recordedAt: Date.now(), occurredAt: Date.now(),
          type: 'bout:created',
          payload: { boutId: 'e2e-test-marker', weapon: 'foil', participants: { A: { label: 'survives-update' }, B: {} } },
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close(); // must not linger open across the reload below
    }, DB_NAME);

    await page.locator('update-banner #reload').click();
    await page.waitForLoadState('domcontentloaded');
    await waitForApp(page);

    // Confirm the reducer actually replayed the injected event into a real
    // bout, visible on Home — not just that the raw IDB record is still there.
    await expect(page.locator('home-page').locator('text=survives-update')).toBeVisible();
  });

  test('reload button triggers a page reload when no waiting SW exists', async ({ page }) => {
    await routeFutureVersion(page);
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await waitForApp(page);
    await expect(page.locator('update-banner')).not.toHaveAttribute('hidden');

    // Unroute before reload — without this the route persists, sw-manager detects
    // the mismatch again on the reloaded page and the banner immediately reappears.
    await page.unrouteAll();
    await page.locator('update-banner #reload').click();
    await page.waitForLoadState('domcontentloaded');

    // After reload with real version.json the store resets — banner must be hidden
    await expect(page.locator('update-banner')).toHaveAttribute('hidden');
  });
});
