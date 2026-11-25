// Mirrors _lib/core/store/store.js's own _uuid() fallback — crypto.randomUUID
// requires a secure context; getRandomValues works everywhere. Needed here
// too since domain ids (boutId) are generated client-side before dispatch,
// separately from the store's own internal event ids.
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));
}
