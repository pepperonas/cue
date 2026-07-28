// Lint layer for the frontend.
//
// The point of this config is `react-hooks`: the bugs this codebase actually
// grows are stale closures and missing effect dependencies, and nothing was
// checking for them. Stylistic rules are deliberately left out — formatting
// bikeshedding would only add noise to the diffs.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TypeScript already resolves identifiers (and knows the DOM lib), so the
      // JS rule would only produce false positives for browser globals.
      'no-undef': 'off',
      // Unused args prefixed with _ are an established pattern here (React
      // Query's onError(_e, _v, ctx) and friends).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Ratchet: errors block, warnings are a reviewed backlog.
      //
      // The rules below currently fire on patterns that were audited and found
      // correct — the "latest callback" ref assignment, effects that sync a
      // server value into local state, and dependency arrays that are narrow on
      // purpose. Rewriting working code just to silence them would be riskier
      // than the warnings are worth, so they stay visible without failing the
      // build. `rules-of-hooks` stays an error: that one is never a false alarm.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
)
