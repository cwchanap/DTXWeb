import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get as mockGet } from 'svelte/store';
import { flushSync } from 'svelte';

const mockPlayingAudio = vi.hoisted(() => ({
	subscribe: vi.fn((cb: (v: unknown) => void) => {
		cb(null);
		return () => {};
	}),
	set: vi.fn()
}));

vi.mock('$lib/store', () => ({
	default: { playingAudio: mockPlayingAudio }
}));

const mockAudio = vi.hoisted(() => ({
	play: vi.fn().mockResolvedValue(undefined),
	pause: vi.fn(),
	addEventListener: vi.fn(),
	remove: vi.fn(),
	currentTime: 0,
	src: '',
	load: vi.fn()
}));

import { createAudioPreview } from './audioPreview.svelte';

const URL_A = 'https://cdn.example.com/a.mp3';

// Each test creates the unit inside `$effect.root(...)` so the factory's
// `$effect` calls have a context, then disposes it at the end.
//
// `$effect.root` schedules its effects on the microtask queue rather than
// running them synchronously, unlike a real component mount (which flushes
// pending effects before the user can interact with anything). Without an
// explicit `flushSync()` right after creation, the unit's first effect run
// gets deferred until the `await audio.toggle()` below yields to microtasks
// — by which point `element` is already assigned, so the "reset on url
// change" effect wrongly treats it as a stale element to pause. Calling
// `flushSync()` immediately after `$effect.root(...)` reproduces the timing
// a real mount guarantees.

describe('createAudioPreview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'Audio',
			vi.fn(() => mockAudio)
		);
		mockPlayingAudio.subscribe.mockImplementation((cb: (v: unknown) => void) => {
			cb(null);
			return () => {};
		});
		mockAudio.play.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports unavailable when there is no source url', () => {
		const dispose = $effect.root(() => {
			const audio = createAudioPreview(() => null);
			flushSync();
			expect(audio.available).toBe(false);
		});
		dispose();
	});

	it('constructs and plays the source url on first toggle', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();

		expect(global.Audio).toHaveBeenCalledWith(URL_A);
		expect(mockAudio.play).toHaveBeenCalledOnce();
		expect(audio.isPlaying).toBe(true);
		expect(mockPlayingAudio.set).toHaveBeenCalledWith(mockAudio);
		dispose();
	});

	it('pauses on the second toggle and clears the shared store', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();
		await audio.toggle();

		expect(mockAudio.pause).toHaveBeenCalledOnce();
		expect(audio.isPlaying).toBe(false);
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(null);
		dispose();
	});

	it('stops another card audio already held in the shared store', async () => {
		const existing = { pause: vi.fn(), remove: vi.fn() };
		vi.mocked(mockGet).mockReturnValueOnce(existing as unknown as HTMLAudioElement);

		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();

		expect(existing.pause).toHaveBeenCalled();
		expect(existing.remove).toHaveBeenCalled();
		dispose();
	});

	it('becomes unavailable when playback rejects', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockAudio.play.mockRejectedValueOnce(new Error('NotAllowedError'));

		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();

		expect(audio.available).toBe(false);
		expect(audio.isPlaying).toBe(false);
		expect(audio.isLoading).toBe(false);
		dispose();
		consoleSpy.mockRestore();
	});

	it('becomes unavailable when the element emits an error', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();

		const errorCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'error'
		);
		expect(errorCall).toBeDefined();
		errorCall![1]();

		expect(audio.available).toBe(false);
		expect(audio.isPlaying).toBe(false);
		dispose();
	});

	it('clears playing state when the element reports it ended', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();

		const endedCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'ended'
		);
		expect(endedCall).toBeDefined();
		endedCall![1]();

		expect(audio.isPlaying).toBe(false);
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(null);
		dispose();
	});
});
