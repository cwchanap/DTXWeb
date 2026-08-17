import { describe, it, expect } from 'vitest';
import { nativeSimfileMatchesModel } from './nativeContract';

describe('nativeContract', () => {
	it('exports a runtime guard confirming the native simfile contract matches the shared model', () => {
		// nativeSimfileMatchesModel is a compile-time type check (NativeSimfile
		// extends SimfileModel ? true : never) surfaced as a runtime constant so
		// a drift between the generated Rust contract and the shared TypeScript
		// model fails both the type checker and the test suite.
		expect(nativeSimfileMatchesModel).toBe(true);
	});
});
