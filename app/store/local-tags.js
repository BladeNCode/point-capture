import { openDB, put, get, del } from '../../_lib/core/idb/idb.js';
import { LOCAL_DB_NAME } from './db-name.js';

// Device-local self-tags, in a database this app owns outright.
//
// Deliberately bypasses store.js's dispatch()/events store entirely — see
// doc 01's anti-profiling model. A self-tag is device-local and must never be
// exportable; keeping it out of the event log sync.js reads makes that true by
// construction rather than by every export call site remembering to filter it.
//
// WHY ITS OWN DATABASE RATHER THAN A STORE IN THE MAIN ONE
//
// This used to open the main DB at Socle's CURRENT_VERSION and rely on a
// `localTags` store added by hand to _lib/core/idb/migrations.js — a patch that
// every `npx socle update` wiped, re-applied twice before this was fixed. We
// proposed an app/migrations.js hook upstream; Socle declined it, and correctly.
//
// IndexedDB gives one integer version and one oldVersion checkpoint, which
// cannot encode two independently-evolving migration sequences. Every scheme
// that tries fails *silently*:
//
//   - App migrations numbered above the library's: we add a store at 3, the DB
//     sits at 3, then Socle ships its own migration — also 3. Existing installs
//     never run ours, fresh installs do. Permanent schema divergence decided by
//     install date, with no error anywhere.
//   - A reserved offset range: fails identically.
//   - Concatenating [...lib, ...app]: appending one library migration shifts
//     our indices, so an upgrade re-runs an already-applied migration
//     (ConstraintError) and skips the new library one.
//
// A separate database has its own counter, so the composition problem does not
// exist. This is also the in-library pattern — Socle's own
// modules/notifications/notification-dedup.js opens its own DB for related
// reasons.
//
// To evolve the schema, APPEND to `migrations` below. Existing installs run
// only the new functions and keep their data.

const migrations = [
  null, // slot 0 — IDB versions start at 1
  // `database`, not `db` — `db()` below is the connection accessor, and a
  // parameter named `db` shadows it.
  database => database.createObjectStore('localTags', { keyPath: 'boutId' }),
];

// Caches the *promise*, not the resolved handle. The previous version awaited
// before assigning, so two concurrent callers both saw null and both opened the
// database. Assigning the promise means they share one open.
//
// Deliberately no close() — that is specific to notification-dedup's
// service-worker background access, and closing here would race page callers.
let _db;

function db() {
  return (_db ??= openDB(LOCAL_DB_NAME, migrations.length - 1, (database, oldV, newV) => {
    for (let v = oldV + 1; v <= newV; v += 1) migrations[v](database);
  }));
}

// LocalSelfTag: { boutId, mySlot: 'A' | 'B' | null, myFencerId }
export async function getLocalTag(boutId) {
  return (await get(await db(), 'localTags', boutId)) ?? null;
}

export async function setLocalTag(boutId, { mySlot, myFencerId }) {
  await put(await db(), 'localTags', { boutId, mySlot, myFencerId });
}

export async function deleteLocalTag(boutId) {
  await del(await db(), 'localTags', boutId);
}

export function _resetForTest() {
  _db = undefined;
}
