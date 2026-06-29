import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import PreviewPage from './+page.svelte';

const getPreviewSimfileMock = vi.hoisted(() => vi.fn());
const parseLevelFromRemoteURLMock = vi.hoisted(() => vi.fn());
const buildNotationChartMock = vi.hoisted(() => vi.fn());
// Controllable PreviewAudioEngine mock state.
const engineLoad = vi.hoisted(() => ({ reject: false, hang: false, failedFiles: [] as string[] }));
const engineState = vi.hoisted(() => ({ currentTime: 0, duration: 2 }));
// Captures the most recently constructed mock engine so tests can fire its
// onEnded callback to simulate the chart reaching its end.
const engineRef = vi.hoisted(() => ({ current: null as null | { onEnded?: () => void } }));
const engineSpies = vi.hoisted(() => ({
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
	dispose: vi.fn()
}));

// Uses the global __mocks__/svelte-i18n.ts where `_` returns the key unchanged,
// so assertions below match on i18n keys, not translated English.
vi.mock('svelte-i18n');
vi.mock('$lib/api', () => ({ getPreviewSimfile: getPreviewSimfileMock }));
vi.mock('$env/static/public', () => ({ PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.test' }));
vi.mock('$lib/components/preview/NotationView.svelte', async () => {
	const Stub = (await import('../../../lib/components/preview/__stubs__/NotationViewStub.svelte'))
		.default;
	return { default: Stub };
});

vi.mock('@dtx/common', () => ({
	SimFile: { parseLevelFromRemoteURL: parseLevelFromRemoteURLMock },
	buildNotationChart: buildNotationChartMock,
	PreviewAudioEngine: class {
		onEnded?: () => void;
		constructor() {
			engineRef.current = this;
		}
		async load() {
			if (engineLoad.reject) throw new Error('audio failure');
			if (engineLoad.hang) return new Promise(() => {});
			return { loaded: 0, failedFiles: engineLoad.failedFiles };
		}
		play = engineSpies.play;
		pause = engineSpies.pause;
		seek = engineSpies.seek;
		dispose = engineSpies.dispose;
		get currentTime() {
			return engineState.currentTime;
		}
		get duration() {
			return engineState.duration;
		}
	}
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('$lib/toaster', () => ({ default: { error: toastError, success: vi.fn() } }));

let routeId: string | null = '5';
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (v: unknown) => void) => {
			run({
				url: new URL(`https://app.test/preview/${routeId ?? ''}`),
				params: { id: routeId ?? '' }
			});
			return () => {};
		}
	}
}));

const makeDtx = () => ({
	title: 'Song',
	bpm: 120,
	difficulty: 'MASTER',
	parseSoundChips: () => []
});

const readyChart = () => ({
	chart: { measures: [{ index: 0, measureTicks: 192, beatsPerMeasure: 4, entries: [] }] },
	timing: {
		totalDuration: 2,
		measureStartSeconds: [0],
		positionToTime: () => 0,
		timeToPosition: () => ({ measure: 0, fraction: 0 })
	},
	notesByLane: {},
	measureCount: 1
});

describe('/preview page', () => {
	beforeEach(() => {
		routeId = '5';
		getPreviewSimfileMock.mockReset();
		parseLevelFromRemoteURLMock.mockReset();
		buildNotationChartMock.mockReset();
		buildNotationChartMock.mockReturnValue(readyChart());
		parseLevelFromRemoteURLMock.mockResolvedValue(makeDtx());
		engineLoad.reject = false;
		engineLoad.hang = false;
		engineLoad.failedFiles = [];
		engineState.currentTime = 0;
		engineState.duration = 2;
		engineSpies.play.mockClear();
		engineSpies.pause.mockClear();
		engineSpies.seek.mockClear();
		engineSpies.dispose.mockClear();
		toastError.mockClear();
	});

	it('shows the loading state before the simfile resolves', () => {
		// Stall getPreviewSimfile so the page stays in the initial 'loading' status.
		getPreviewSimfileMock.mockReturnValue(new Promise(() => {}));
		render(PreviewPage);
		expect(screen.getByText('preview.loading')).toBeTruthy();
	});

	it('shows "not available" when the simfile is not found', async () => {
		getPreviewSimfileMock.mockRejectedValue(new Error('Simfile not found'));
		render(PreviewPage);
		await waitFor(() => expect(screen.getByText('preview.not_available')).toBeTruthy());
	});

	it('shows "not available" when the route has no id', async () => {
		routeId = null;
		getPreviewSimfileMock.mockResolvedValue({ id: 5, title: 'Song', artist: 'A', levels: [] });
		render(PreviewPage);
		await waitFor(() => expect(screen.getByText('preview.not_available')).toBeTruthy());
	});

	it('renders the notation when the chart loads', async () => {
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
	});

	it('shows a level switcher and rebuilds the chart when the level changes', async () => {
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [
				{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' },
				{ level: 3, label: 'BASIC', fileUrl: 'https://bucket.test/5/basic.dtx' }
			]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// buildNotationChart runs once per level load (buildForLevel builds the
		// chart and passes the result into loadAudioForLevel, which no longer
		// rebuilds).
		const initialCalls = buildNotationChartMock.mock.calls.length;
		expect(initialCalls).toBeGreaterThanOrEqual(1);
		// Switch to the BASIC level via the select.
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: '3' } });
		// A level switch fetches the new DTXFile then rebuilds the chart once
		// (a single buildNotationChart call). The fetch is async, so wait for
		// the build to land.
		await waitFor(() =>
			expect(buildNotationChartMock.mock.calls.length).toBe(initialCalls + 1)
		);
	});

	it('toasts an error when some audio files fail to load', async () => {
		engineLoad.failedFiles = ['missing.wav'];
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
	});

	it('falls back to visual-only playback on total audio failure', async () => {
		engineLoad.reject = true;
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		// The catch path disposes the engine and toasts, but keeps audioReady.
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		expect(engineSpies.dispose).toHaveBeenCalled();
	});

	it('toggles playback via the transport button (engine.play path)', async () => {
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		const playButton = await screen.findByLabelText('preview.play');
		// Wait until audio is ready (button enabled).
		await waitFor(() => expect(playButton.hasAttribute('disabled')).toBe(false));
		await fireEvent.click(playButton);
		expect(engineSpies.play).toHaveBeenCalled();
		// Click again to pause.
		await fireEvent.click(playButton);
		expect(engineSpies.pause).toHaveBeenCalled();
	});

	it('restarts from the beginning when pressing play after the song ends', async () => {
		// Regression: after the chart ends, engine.currentTime reports the full
		// duration. Calling play(duration) -> remaining = 0 -> the end timer
		// fires instantly, so the transport flickered Pause→Play→Pause with no
		// audio. Pressing play at the end must restart from 0 instead.
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		const playButton = await screen.findByLabelText('preview.play');
		await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
		// Start playback once.
		await fireEvent.click(playButton);
		engineSpies.play.mockClear();
		// Simulate the chart ending: the page's onEnded snaps currentSeconds to
		// the duration so the replay-after-end check can fire.
		expect(engineRef.current?.onEnded).toBeTruthy();
		engineRef.current?.onEnded?.();
		// Press play again -> must restart from 0, not from currentTime.
		await fireEvent.click(playButton);
		expect(engineSpies.play).toHaveBeenCalledWith(0);
	});

	it('toggles playback via the spacebar and ignores it for form controls', async () => {
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// The shortcut is disabled until audio is ready (matching the transport
		// button), so wait for the play label + enabled state before firing space.
		const playButton = await screen.findByLabelText('preview.play');
		await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
		// Space on the window toggles play.
		await fireEvent.keyDown(window, { key: ' ', code: 'Space' });
		expect(engineSpies.play).toHaveBeenCalledTimes(1);
		// Space on a BUTTON target is ignored (native behavior preserved).
		await fireEvent.keyDown(playButton, { key: ' ', code: 'Space' });
		expect(engineSpies.play).toHaveBeenCalledTimes(1); // still 1, not 2
	});

	it('ignores the spacebar shortcut until audio is ready', async () => {
		// Hang the audio load so audioReady stays false; the spacebar must not
		// start wall-clock playback during engine.load() (matches the disabled
		// transport button).
		engineLoad.hang = true;
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// While audio is still loading the transport shows the loading label and
		// the button is disabled. (Target by label: the notation stub also renders
		// a button, so getByRole('button') is ambiguous.)
		const btn = screen.getByLabelText('preview.audio_loading') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		await fireEvent.keyDown(window, { key: ' ', code: 'Space' });
		expect(engineSpies.play).not.toHaveBeenCalled();
	});

	it('seeks via the notation onSeek handler', async () => {
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// Wait for audio ready so handleSeek takes the engine.seek branch.
		await waitFor(() =>
			expect((screen.getByLabelText('preview.play') as HTMLButtonElement).disabled).toBe(
				false
			)
		);
		const seekButton = screen.getByTestId('stub-seek');
		await fireEvent.click(seekButton);
		expect(engineSpies.seek).toHaveBeenCalled();
	});

	it('drives visual-only (wall-clock) playback when audio is unavailable', async () => {
		// Total audio failure -> engine is null; playback falls back to a wall
		// clock driven by requestAnimationFrame + performance.now.
		engineLoad.reject = true;
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));

		// Capture rAF callbacks and control the wall clock so tickCursor is
		// deterministic (no real waiting).
		const rafCallbacks: FrameRequestCallback[] = [];
		const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
			rafCallbacks.push(cb);
			return rafCallbacks.length;
		});
		const cancelRafSpy = vi
			.spyOn(globalThis, 'cancelAnimationFrame')
			.mockImplementation(() => {});
		let now = 1000;
		const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
		try {
			const playButton = await screen.findByLabelText('preview.play');
			await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
			// Toggle play -> handleToggle wall-clock branch (engine is null).
			await fireEvent.click(playButton);
			expect(rafCallbacks.length).toBe(1);
			// Advance the wall clock past the chart duration and drive the rAF
			// tick -> tickCursor wall-clock branch + end-detection branch.
			now = 4000; // t = (4000 - 1000)/1000 = 3 >= totalDuration (2)
			rafCallbacks[0](now);
			// Seek while paused with no engine -> handleSeek wall-clock branch.
			const seekButton = screen.getByTestId('stub-seek');
			await fireEvent.click(seekButton);
			// Playback ended -> the button label is back to 'preview.play'.
			expect(screen.getByLabelText('preview.play')).toBeTruthy();
		} finally {
			rafSpy.mockRestore();
			cancelRafSpy.mockRestore();
			perfSpy.mockRestore();
		}
	});
});
