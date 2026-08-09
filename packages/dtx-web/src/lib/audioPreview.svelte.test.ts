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

// Retained by the subscribe mock below so tests can drive the
// store-subscription branch directly (see "another card takes over").
let retainedPlayingAudioCallback: ((v: unknown) => void) | null = null;

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

import { createAudioPreview } from '$lib/audioPreview.svelte';

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
		// `get` is auto-mocked globally (src/tests/setup.ts). Reset its
		// implementation each run so a per-test `mockReturnValue` cannot leak
		// into the next test; the default `() => undefined` matches the
		// auto-mock, and tests that need a specific return value configure it
		// explicitly below.
		vi.mocked(mockGet).mockReset();
		vi.stubGlobal(
			'Audio',
			vi.fn(() => mockAudio)
		);
		retainedPlayingAudioCallback = null;
		mockPlayingAudio.subscribe.mockImplementation((cb: (v: unknown) => void) => {
			retainedPlayingAudioCallback = cb;
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

	it('does not clear another card ownership when this playback fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		// Two distinct elements: B plays successfully, A's play rejects.
		const elements = [0, 1].map(() => ({
			play: vi.fn(),
			pause: vi.fn(),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			currentTime: 0,
			src: '',
			load: vi.fn()
		}));
		elements[0].play.mockResolvedValue(undefined);
		elements[1].play.mockRejectedValueOnce(new Error('NotAllowedError'));

		let constructCount = 0;
		vi.stubGlobal(
			'Audio',
			vi.fn(() => elements[constructCount++])
		);

		// B's post-await get sees no owner; A never reaches the post-await get
		// because its play() rejects.
		vi.mocked(mockGet).mockReturnValue(undefined);

		let audioA!: ReturnType<typeof createAudioPreview>;
		let audioB!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audioA = createAudioPreview(() => URL_A);
			audioB = createAudioPreview(() => URL_A);
		});
		flushSync();

		// B plays first and claims the store.
		await audioB.toggle();
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[0]);
		expect(audioB.isPlaying).toBe(true);

		// A's playback fails.
		await audioA.toggle();
		expect(audioA.isPlaying).toBe(false);
		expect(audioA.available).toBe(false);

		// The store still reflects B's ownership — the failed attempt did
		// not clear it, so B's audio keeps playing with its UI intact.
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[0]);
		expect(mockPlayingAudio.set).not.toHaveBeenCalledWith(null);
		expect(audioB.isPlaying).toBe(true);

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
		// The ended handler only clears the store when `get(store.playingAudio)`
		// still returns this element, so make the auto-mocked `get` report the
		// created element as the active owner.
		vi.mocked(mockGet).mockReturnValue(mockAudio);
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

	it('cleans up the stale element when replaying after it ended', async () => {
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

		mockAudio.pause.mockClear();
		mockAudio.remove.mockClear();

		await audio.toggle();

		// The stale element from the ended playback is paused and removed before
		// a fresh Audio instance is constructed for the replay.
		expect(mockAudio.pause).toHaveBeenCalled();
		expect(mockAudio.remove).toHaveBeenCalled();
		expect(global.Audio).toHaveBeenCalledTimes(2);
		dispose();
	});

	it('ignores a second toggle while the first one is still loading', async () => {
		// Two distinct elements so we can tell whether the second toggle acted on
		// the first (in-flight) element at all.
		const elements = [0, 1].map(() => ({
			play: vi.fn(),
			pause: vi.fn(),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			currentTime: 0,
			src: '',
			load: vi.fn()
		}));
		let resolvePlay!: () => void;
		const pendingPlay = new Promise<void>((resolve) => {
			resolvePlay = resolve;
		});
		elements[0].play.mockReturnValue(pendingPlay);
		elements[1].play.mockResolvedValue(undefined);

		let constructCount = 0;
		vi.stubGlobal(
			'Audio',
			vi.fn(() => elements[constructCount++])
		);

		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();

		const firstToggle = audio.toggle();
		const secondToggle = audio.toggle();

		resolvePlay();
		await firstToggle;
		await secondToggle;

		expect(global.Audio).toHaveBeenCalledTimes(1);
		expect(elements[0].pause).not.toHaveBeenCalled();
		expect(elements[0].remove).not.toHaveBeenCalled();
		expect(audio.isPlaying).toBe(true);
		dispose();
	});

	it('clears isPlaying when another card takes over the shared store', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();
		expect(audio.isPlaying).toBe(true);

		// Simulate another card claiming the shared store by re-invoking the
		// retained subscription callback, rather than only relying on the
		// subscribe-time call captured at mount.
		expect(retainedPlayingAudioCallback).not.toBeNull();
		retainedPlayingAudioCallback!(null);

		expect(audio.isPlaying).toBe(false);
		dispose();
	});

	it('clears isPlaying when another card emits its element, not null', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		flushSync();
		await audio.toggle();
		expect(audio.isPlaying).toBe(true);

		// A successful takeover sets the store to the new element, not null.
		// The subscription must treat any non-self value as loss of ownership
		// so a stale Pause button here cannot later clear the real owner.
		const foreignElement = {
			pause: vi.fn(),
			remove: vi.fn()
		} as unknown as HTMLAudioElement;
		expect(retainedPlayingAudioCallback).not.toBeNull();
		retainedPlayingAudioCallback!(foreignElement);

		expect(audio.isPlaying).toBe(false);
		dispose();
	});

	it('stops playback and clears error state when the source url changes', async () => {
		let url = $state(URL_A);
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => url);
		});
		flushSync();
		await audio.toggle();
		expect(audio.isPlaying).toBe(true);

		url = 'https://cdn.example.com/b.mp3';
		flushSync();

		expect(mockAudio.pause).toHaveBeenCalled();
		expect(audio.isPlaying).toBe(false);
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(null);
		// hasError is unconditionally reset alongside the playback cleanup, so a
		// fresh source is reported available rather than stuck behind a stale error.
		expect(audio.available).toBe(true);
		dispose();
	});

	it('only the latest click owns the store when two cards race to play', async () => {
		// Two distinct elements so the second card's playback can be observed
		// stopping the first card's element after both play() promises resolve.
		const elements = [0, 1].map(() => ({
			play: vi.fn(),
			pause: vi.fn(),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			currentTime: 0,
			src: '',
			load: vi.fn()
		}));
		let resolvePlayA!: () => void;
		let resolvePlayB!: () => void;
		const pendingPlayA = new Promise<void>((resolve) => {
			resolvePlayA = resolve;
		});
		const pendingPlayB = new Promise<void>((resolve) => {
			resolvePlayB = resolve;
		});
		elements[0].play.mockReturnValue(pendingPlayA);
		elements[1].play.mockReturnValue(pendingPlayB);

		let constructCount = 0;
		vi.stubGlobal(
			'Audio',
			vi.fn(() => elements[constructCount++])
		);

		// B is clicked after A, so B holds the newer request token. Only B
		// calls `get` (A abandons at the token check before reaching it); B
		// sees no owner and claims the store.
		vi.mocked(mockGet).mockReturnValue(undefined);

		let audioA!: ReturnType<typeof createAudioPreview>;
		let audioB!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audioA = createAudioPreview(() => URL_A);
			audioB = createAudioPreview(() => URL_A);
		});
		flushSync();

		// Start both toggles before either play() resolves, so both are
		// in-flight concurrently. Click order — not resolution order —
		// decides ownership.
		const toggleA = audioA.toggle();
		const toggleB = audioB.toggle();

		// A resolves first, but B's newer request is still pending, so A
		// abandons its element without claiming the store.
		resolvePlayA();
		await toggleA;
		expect(mockPlayingAudio.set).not.toHaveBeenCalledWith(elements[0]);
		expect(audioA.isPlaying).toBe(false);
		expect(elements[0].pause).toHaveBeenCalled();
		expect(elements[0].remove).toHaveBeenCalled();

		// B resolves next and claims the store as the latest click.
		resolvePlayB();
		await toggleB;
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[1]);
		expect(audioB.isPlaying).toBe(true);

		dispose();
	});

	it('a slower older click does not override a faster newer click', async () => {
		// Click A, then click B. B's play() resolves first and claims the
		// store; A's slower play() resolves afterward and must abandon rather
		// than pausing B and claiming the store for itself. This is the
		// reverse of the test above and guards the specific race the
		// post-await ownership check alone could not.
		const elements = [0, 1].map(() => ({
			play: vi.fn(),
			pause: vi.fn(),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			currentTime: 0,
			src: '',
			load: vi.fn()
		}));
		let resolvePlayA!: () => void;
		let resolvePlayB!: () => void;
		const pendingPlayA = new Promise<void>((resolve) => {
			resolvePlayA = resolve;
		});
		const pendingPlayB = new Promise<void>((resolve) => {
			resolvePlayB = resolve;
		});
		elements[0].play.mockReturnValue(pendingPlayA);
		elements[1].play.mockReturnValue(pendingPlayB);

		let constructCount = 0;
		vi.stubGlobal(
			'Audio',
			vi.fn(() => elements[constructCount++])
		);

		// B's get (first call) sees no owner and claims. Under the bug, A's
		// get (second call) would see B's element and pause it; with the token
		// fix A abandons before ever calling get, so the second mock is never
		// consumed.
		vi.mocked(mockGet).mockReturnValueOnce(undefined).mockReturnValueOnce(elements[1]);

		let audioA!: ReturnType<typeof createAudioPreview>;
		let audioB!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audioA = createAudioPreview(() => URL_A);
			audioB = createAudioPreview(() => URL_A);
		});
		flushSync();

		const toggleA = audioA.toggle();
		const toggleB = audioB.toggle();

		// B resolves first and claims the store as the latest click.
		resolvePlayB();
		await toggleB;
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[1]);
		expect(audioB.isPlaying).toBe(true);

		// A resolves later but is stale; it must abandon without touching B.
		resolvePlayA();
		await toggleA;
		expect(elements[1].pause).not.toHaveBeenCalled();
		expect(elements[1].remove).not.toHaveBeenCalled();
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[1]);
		expect(audioA.isPlaying).toBe(false);
		expect(audioB.isPlaying).toBe(true);

		dispose();
	});

	it('a stale ended completion does not clear a newer card playback', async () => {
		// Card A plays, then card B takes over the store. When A's element
		// later emits 'ended', the ownership guard must keep B's playback
		// intact rather than clearing the shared store out from under it.
		const elements = [0, 1].map(() => ({
			play: vi.fn().mockResolvedValue(undefined),
			pause: vi.fn(),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			currentTime: 0,
			src: '',
			load: vi.fn()
		}));
		let constructCount = 0;
		vi.stubGlobal(
			'Audio',
			vi.fn(() => elements[constructCount++])
		);

		// A's post-await get sees no owner; B's post-await get sees A's
		// element. The later 'ended' handler get still reports B's element as
		// owner, so A's handler must NOT clear the store.
		vi.mocked(mockGet)
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce(elements[0])
			.mockReturnValue(elements[1]);

		let audioA!: ReturnType<typeof createAudioPreview>;
		let audioB!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audioA = createAudioPreview(() => URL_A);
			audioB = createAudioPreview(() => URL_A);
		});
		flushSync();

		await audioA.toggle();
		await audioB.toggle();
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[1]);

		// Fire A's 'ended' listener — a stale completion from the superseded card.
		const aEnded = elements[0].addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'ended'
		);
		expect(aEnded).toBeDefined();
		aEnded![1]();

		// B still owns the store: the last `set` is still elements[1], not null.
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(elements[1]);
		expect(audioB.isPlaying).toBe(true);

		dispose();
	});
});
