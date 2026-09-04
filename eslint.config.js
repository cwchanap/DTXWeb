import eslint from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
	{
		linterOptions: { reportUnusedDisableDirectives: 'off' }
	},
	{
		ignores: [
			'.DS_Store',
			'node_modules',
			'/build',
			'/.svelte-kit',
			'**/.svelte-kit',
			'/package',
			'.env',
			'.env.*',
			'!.env.example',
			'pnpm-lock.yaml',
			'package-lock.json',
			'yarn.lock',
			'**/dist',
			'**/out',
			'**/dist-server',
			'**/coverage',
			'**/*.svelte.d.ts',
			'**/*.sh',
			'**/worker-configuration.d.ts'
		]
	},
	eslint.configs.recommended,
	{
		// eslint 10 core added these to recommended; keep v8 rule parity for this
		// migration — enable + fix findings in a follow-up
		rules: {
			'no-useless-assignment': 'off',
			'preserve-caught-error': 'off'
		}
	},
	{
		files: ['**/*.{js,cjs,mjs,ts,svelte}'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				sourceType: 'module',
				ecmaVersion: 2020
			},
			globals: { ...globals.browser, ...globals.node }
		},
		plugins: {
			'@typescript-eslint': tsPlugin
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			// typescript-eslint v8 flipped caughtErrors to 'all'; keep v7 behavior
			'@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }]
		}
	},
	{
		files: ['**/*.{ts,mts,cts}'],
		rules: {
			// typescript-eslint v8 ships the eslint-recommended base-rule overrides only via the
			// `typescript-eslint` wrapper package; apply the ones that matter here manually.
			'no-undef': 'off',
			'no-redeclare': 'off'
		}
	},
	...svelte.configs['flat/recommended'],
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: { parser: tsParser }
		},
		rules: {
			// Svelte 5 reactive tracking idiom: bare expressions inside $effect
			'@typescript-eslint/no-unused-expressions': 'off'
		}
	},
	{
		files: [
			'**/__mocks__/**',
			'**/*.test.*',
			'**/*.spec.*',
			'packages/e2e-web/**',
			'packages/e2e-desktop/**'
		],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off'
		}
	},
	prettier
];
