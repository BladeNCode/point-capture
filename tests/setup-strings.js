// Registers the app's strings for every test file, mirroring what main.js does
// at boot.
//
// A setup file rather than a per-file import, deliberately. t() falls back to
// returning the key when a string is unregistered, so a test file that forgot
// to import app/strings.js does not fail with a missing-string error — it
// quietly asserts against "card-picker.cancel" and either passes for the wrong
// reason or fails somewhere confusing. Registering globally means a newly
// added test file cannot forget.
//
// Safe alongside Socle's own strings.test.js, which calls reset(): it uses
// _snapshot()/_restore() precisely so it cannot destroy strings a consuming
// app registered before it ran, which matters under `isolate: false` where the
// locale table is shared across files in a worker.
import '../app/strings.js';
