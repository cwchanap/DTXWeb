import { describe, it, expect, vi, afterEach } from 'vitest';

// Reproduces the SSR crash: when this module is evaluated on a server (Vite SSR
// / Cloudflare Worker) there is no global `AudioContext`, so a top-level
// `class XAAudioContext extends AudioContext` throws at module-evaluation time
// ("Class extends value undefined") and 500s any page importing
// `@dtx/common/audio` (e.g. /preview, which pulls it in via PreviewAudioEngine).
describe('audioDecoder SSR safety', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('evaluates without a global AudioContext (server-side)', async () => {
		vi.resetModules();
		vi.stubGlobal('AudioContext', undefined);
		// Must not throw during evaluation.
		const mod = await import('./audioDecoder');
		expect(mod.XAAudioContext).toBeTypeOf('function');
		// The eager `export const XAaudioContext = new XAAudioContext()` line must
		// also survive evaluation without a real AudioContext.
		expect(mod.XAaudioContext).toBeDefined();
	});
});
