import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  resolve: {
    // Mirrors the esbuild alias in utils/build.js (Socle 1.4.0+). Shared
    // components live outside the app tree at app/shared -> fencing-shared,
    // so they cannot reach the library by relative path; 'socle/...' is
    // depth-independent and resolves the same way here and in the build.
    // This replaced preserveSymlinks: true — the alias is absolute, so it no
    // longer matters that the resolver sees a symlink's real path.
    alias: { socle: fileURLToPath(new URL('./_lib', import.meta.url)) },
  },
  server: {
    fs: { allow: ['..'] },
  },
  test: {
    // app/shared/** is the symlinked shared repo: its tests ship with the
    // components and run against *this* app's Socle version, which is how
    // library drift gets caught at the consumer.
    include: ['tests/unit/**/*.test.js', '_lib/**/*.test.js', 'app/shared/**/*.test.js'],
    environment: 'node',
    // Socle's setup first (fake-indexeddb), then our string registration — see
    // tests/setup-strings.js for why that is global rather than per-file.
    setupFiles: ['./_lib/core/test-setup.js', './tests/setup-strings.js'],

    // Coverage now SEES the shared components, which it could not while
    // app/shared was a symlink — V8 attributed those files to a real path
    // outside the project root and silently dropped them, so the headline
    // figure described the app only with ~1,500 shared lines unmeasured.
    // Nothing configured that away (allowExternal and include globs for both
    // the symlink and real paths were all tried); the submodule fixed it,
    // because the files are now genuinely inside the root.
    //
    // What that revealed, worth knowing before any threshold is set: the
    // shared components are markedly less covered than the app.
    // card-picker.js sits at 48% branch and sound.js at 43% statements,
    // because Web Audio and scroll-snap paging are both awkward in a Node
    // test environment. Neither gap was visible before.
  },
});
