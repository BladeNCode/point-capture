// RENAMED from 'Point Capture' when the project became Point Capture. An
// IndexedDB name is an identity, not a label — the old database still exists on
// any device that ran the previous build and is simply unreachable now. Agreed
// deliberately: there are no users and no data worth migrating. If that ever
// stops being true, renaming these needs a migration, not an edit.
//
// The event-sourced store Socle manages: events, images, and whatever future
// library versions add. Its version counter belongs to Socle.
export const DB_NAME = 'Point Capture';

// Device-local app-owned data, in a separate database with its own version
// counter — see app/store/local-tags.js for why these cannot share one. Named
// distinctly so it is obvious in devtools which database a store belongs to.
export const LOCAL_DB_NAME = 'Point Capture (local)';
