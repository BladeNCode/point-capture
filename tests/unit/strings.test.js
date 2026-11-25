// Guards the failure mode t() is built around: an unregistered key is returned
// verbatim, so a missing string renders "capture.void.confirm" on a button and
// nothing reports a problem. A page test only catches that if it happens to
// assert the exact text, which most do not.
//
// The shared components have their own version of this in
// fencing-shared/strings/en.test.js, which runs in that repo's gate. This one
// covers the app's own pages AND the shared table it registers, because the
// registration is what the app is responsible for.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../../_lib/core/strings.js';

const sources = ['app/pages', 'app/store'].flatMap(dir =>
  readdirSync(join(process.cwd(), dir))
    .filter(f => f.endsWith('.js'))
    .map(f => ({ file: `${dir}/${f}`, src: readFileSync(join(process.cwd(), dir, f), 'utf8') }))
);

const literalKeys = src => [...src.matchAll(/\bt\(\s*'([^']+)'/g)].map(m => m[1]);

describe('string registration', () => {
  it('finds t() calls at all — the scanner is not silently matching nothing', () => {
    // Without this, a regex that matched nothing would make every assertion
    // below pass vacuously. That exact false negative has happened here.
    const total = sources.reduce((n, { src }) => n + literalKeys(src).length, 0);
    expect(total).toBeGreaterThan(30);
  });

  it.each(sources.filter(s => literalKeys(s.src).length > 0).map(s => s.file))(
    '%s asks only for registered keys',
    file => {
      const { src } = sources.find(s => s.file === file);
      // t() returns the key when unregistered, so "resolves to itself" is the
      // test for "missing" — except where a key legitimately equals its value.
      const missing = literalKeys(src).filter(k => t(k) === k);
      expect(missing, `unregistered keys in ${file}`).toEqual([]);
    }
  );

  it('resolves the dynamic keys the scanner cannot see', () => {
    // Built at runtime from data: side.A/B, weapon.*, status.*, card.*.inline.
    // Enumerated rather than skipped — a scanner that quietly ignores what it
    // cannot parse is worse than none.
    for (const k of ['side.A', 'side.B']) expect(t(k)).not.toBe(k);
    for (const w of ['foil', 'epee', 'sabre']) expect(t(`weapon.${w}`)).not.toBe(`weapon.${w}`);
    for (const s of ['in-progress', 'complete']) expect(t(`status.${s}`)).not.toBe(`status.${s}`);
    for (const c of ['yellow', 'red', 'black']) expect(t(`card.${c}.inline`)).not.toBe(`card.${c}.inline`);
  });

  it('registers the shared components table, not just the app table', () => {
    // app/strings.js imports fencing-shared/strings/en.js and registers it.
    // If that import is dropped, every shared component silently renders keys.
    expect(t('card-picker.cancel')).toBe('Cancel');
    expect(t('match-timer.label.halted')).toContain('{time}');
  });

  it('interpolates parameters rather than leaving them literal', () => {
    expect(t('home.vs', { a: 'Alice', b: 'Bob' })).toBe('Alice vs Bob');
    expect(t('capture.row.period', { period: 2 })).toBe('Period 2');
  });

  it('never renders a stored enum value raw', () => {
    // The bug this replaced: the bout list showed "epee" and "in-progress"
    // straight from the event. A stored value must not reach the screen.
    expect(t('weapon.epee')).toBe('Épée');
    expect(t('status.in-progress')).toBe('in progress');
  });
});
