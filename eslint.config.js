// Correctness only — deliberately not a style tool.
//
// Socle itself has no linter: it encodes project rules as tests in
// library_tests/ instead, and we follow that for anything domain-specific
// (boundaries.test.js, strings/en.test.js, tests/unit/strings.test.js). This
// config covers the other class — generic JS mistakes a test only catches if
// it happens to execute the broken line.
//
// Three real bugs from the i18n pass would have been caught here:
//   - a parameter named `t` shadowing the imported t()      -> no-shadow
//   - calls to an undefined t2() and cardInline()           -> no-undef
//   - `const label` left orphaned after a rewrite           -> no-unused-vars
//
// NO FORMATTER, on purpose. The string tables and comment blocks are
// hand-aligned for readability; Prettier or Biome-format would reflow all of
// it and bury real diffs in whitespace churn.
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Browser surface this app actually uses.
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', history: 'readonly', customElements: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', indexedDB: 'readonly',
        fetch: 'readonly', caches: 'readonly', self: 'readonly',
        HTMLElement: 'readonly', CustomEvent: 'readonly', Event: 'readonly',
        PointerEvent: 'readonly', KeyboardEvent: 'readonly', CSSStyleSheet: 'readonly',
        AudioContext: 'readonly', webkitAudioContext: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', queueMicrotask: 'readonly',
        console: 'readonly', globalThis: 'readonly', structuredClone: 'readonly',
        crypto: 'readonly', TextEncoder: 'readonly', URL: 'readonly',
        performance: 'readonly', AbortController: 'readonly', Node: 'readonly',
        getComputedStyle: 'readonly', matchMedia: 'readonly',
        // Build-time defines, substituted by esbuild.
        __APP_VERSION__: 'readonly', __BASE_PATH__: 'readonly',
      },
    },
    rules: {
      // The three that would have caught real bugs here.
      'no-shadow': 'error',
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // no-undef comes from recommended; keep it loud.
      'no-undef': 'error',

      // Cheap guards against mistakes this codebase is actually prone to.
      'no-template-curly-in-string': 'error', // '${x}' in a plain quoted string
      'no-fallthrough': 'error',              // the reducers are large switches
      'eqeqeq': ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // These run in Node, not the browser: tests, the build script, configs.
    files: ['tests/**/*.js', 'utils/**/*.js', '*.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly', __dirname: 'readonly', Buffer: 'readonly',
        // Available in Node 17+; tests use it to simulate blocked storage.
        DOMException: 'readonly',
      },
    },
  },
  {
    // Library code is Socle's to lint, and dist/ is generated.
    ignores: ['_lib/**', 'dist/**', 'coverage/**', 'node_modules/**', 'app/shared/**'],
  },
];
