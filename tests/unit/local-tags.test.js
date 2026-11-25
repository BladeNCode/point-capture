import { describe, it, expect, beforeEach, vi } from 'vitest';

let dbSeq = 0;

// Self-tags live in a database this app owns outright, separate from the
// Socle-managed event store — see app/store/local-tags.js for why the two
// cannot share one version counter.
async function freshModule(dbName) {
  vi.resetModules();
  vi.doMock('../../app/store/db-name.js', () => ({
    DB_NAME: `${dbName}-events`,
    LOCAL_DB_NAME: dbName,
  }));
  return import('../../app/store/local-tags.js');
}

describe('local-tags', () => {
  beforeEach(() => {
    dbSeq += 1;
  });

  it('returns null for a bout with no tag set', async () => {
    const { getLocalTag } = await freshModule(`test-local-tags-${dbSeq}`);
    expect(await getLocalTag('bout-1')).toBeNull();
  });

  it('round-trips a self-tag by boutId', async () => {
    const { getLocalTag, setLocalTag } = await freshModule(`test-local-tags-${dbSeq}`);
    await setLocalTag('bout-1', { mySlot: 'A', myFencerId: 'fencer-1' });
    expect(await getLocalTag('bout-1')).toEqual({ boutId: 'bout-1', mySlot: 'A', myFencerId: 'fencer-1' });
  });

  it('overwrites an existing tag for the same bout', async () => {
    const { getLocalTag, setLocalTag } = await freshModule(`test-local-tags-${dbSeq}`);
    await setLocalTag('bout-1', { mySlot: 'A', myFencerId: 'fencer-1' });
    await setLocalTag('bout-1', { mySlot: 'B', myFencerId: 'fencer-1' });
    expect(await getLocalTag('bout-1')).toEqual({ boutId: 'bout-1', mySlot: 'B', myFencerId: 'fencer-1' });
  });

  it('keeps tags for different bouts independent', async () => {
    const { getLocalTag, setLocalTag } = await freshModule(`test-local-tags-${dbSeq}`);
    await setLocalTag('bout-1', { mySlot: 'A', myFencerId: 'fencer-1' });
    await setLocalTag('bout-2', { mySlot: 'B', myFencerId: 'fencer-1' });
    expect(await getLocalTag('bout-1')).toMatchObject({ mySlot: 'A' });
    expect(await getLocalTag('bout-2')).toMatchObject({ mySlot: 'B' });
  });

  it('removes a tag', async () => {
    const { getLocalTag, setLocalTag, deleteLocalTag } = await freshModule(`test-local-tags-${dbSeq}`);
    await setLocalTag('bout-1', { mySlot: 'A', myFencerId: 'fencer-1' });

    await deleteLocalTag('bout-1');

    expect(await getLocalTag('bout-1')).toBeNull();
  });

  it('opens the database once when callers arrive concurrently', async () => {
    // The previous version awaited openDB *before* assigning its cache, so two
    // simultaneous callers both saw an empty cache and both opened the
    // database. Caching the promise instead means they share one open.
    const { getLocalTag, setLocalTag } = await freshModule(`test-local-tags-${dbSeq}`);

    const results = await Promise.all([
      setLocalTag('bout-1', { mySlot: 'A', myFencerId: 'f1' }),
      getLocalTag('bout-1'),
      getLocalTag('bout-2'),
      setLocalTag('bout-2', { mySlot: 'B', myFencerId: 'f1' }),
    ]);

    expect(results).toHaveLength(4);
    expect(await getLocalTag('bout-1')).toMatchObject({ mySlot: 'A' });
    expect(await getLocalTag('bout-2')).toMatchObject({ mySlot: 'B' });
  });

  it('does not create its store in the event database', async () => {
    // The point of the separate database: nothing here may depend on a store
    // hand-added to Socle's own migrations, which `socle update` wipes.
    const { CURRENT_VERSION } = await import('../../_lib/core/idb/migrations.js');
    const { openDB } = await import('../../_lib/core/idb/idb.js');
    const { runMigrations } = await import('../../_lib/core/idb/migrations.js');

    const eventsDb = await openDB(`test-events-${dbSeq}`, CURRENT_VERSION, runMigrations);

    expect([...eventsDb.objectStoreNames]).not.toContain('localTags');
    expect([...eventsDb.objectStoreNames]).toContain('events');
  });
});
