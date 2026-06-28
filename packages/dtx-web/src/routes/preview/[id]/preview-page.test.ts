import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import PreviewPage from './+page.svelte';

const getSimfileMock = vi.hoisted(() => vi.fn());
const parseFromRemoteURLMock = vi.hoisted(() => vi.fn());
const buildNotationChartMock = vi.hoisted(() => vi.fn());
// Controllable PreviewAudioEngine mock state.
const engineLoad = vi.hoisted(() => ({ reject: false, failedFiles: [] as string[] }));
const engineState = vi.hoisted(() => ({ currentTime: 0, duration: 2 }));
const engineSpies = vi.hoisted(() => ({
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
	dispose: vi.fn()
}));

// Uses the global __mocks__/svelte-i18n.ts where `_` returns the key unchanged,
// so assertions below match on i18n keys, not translated English.
vi.mock('svelte-i18n');
vi.mock('$lib/api', () => ({ getSimfile: getSimfileMock }));
vi.mock('$env/static/public', () => ({ PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.test' }));
vi.mock('$lib/components/preview/NotationView.svelte', async () => {
	const Stub = (await import('../../../lib/components/preview/__stubs__/NotationViewStub.svelte'))
		.default;
	return { default: Stub };
});

vi.mock('@dtx/common', () => ({
	SimFile: { parseFromRemoteURL: parseFromRemoteURLMock },
	buildNotationChart: buildNotationChartMock,
	PreviewAudioEngine: class {
		onEnded?: () => void;
		async load() {
			if (engineLoad.reject) throw new Error('audio failure');
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

const makeSimFile = () => ({
	title: 'Song',
	levels: { 4: { label: 'MASTER', file: makeDtx() } },
	getHighestLevel: () => makeDtx(),
	getLevel: () => makeDtx()
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
		getSimfileMock.mockReset();
		parseFromRemoteURLMock.mockReset();
		buildNotationChartMock.mockReset();
		buildNotationChartMock.mockReturnValue(readyChart());
		engineLoad.reject = false;
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
		// Stall getSimfile so the page stays in the initial 'loading' status.
		getSimfileMock.mockReturnValue(new Promise(() => {}));
		render(PreviewPage);
		expect(screen.getByText('preview.loading')).toBeTruthy();
	});

	it('shows "not available" when the simfile is not found', async () => {
		getSimfileMock.mockRejectedValue(new Error('Simfile not found'));
		render(PreviewPage);
		await waitFor(() => expect(screen.getByText('preview.not_available')).toBeTruthy());
	});

	it('shows "not available" when the route has no id', async () => {
		routeId = null;
		getSimfileMock.mockResolvedValue({ id: 5, title: 'Song', artist: 'A', dtx_files: [] });
		render(PreviewPage);
		await waitFor(() => expect(screen.getByText('preview.not_available')).toBeTruthy());
	});

	it('renders the notation when the chart loads', async () => {
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
	});

	it('shows a level switcher and rebuilds the chart when the level changes', async () => {
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [
				{ level: 4, label: 'MASTER' },
				{ level: 3, label: 'BASIC' }
			]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// buildNotationChart runs once in buildForLevel and once in loadAudioForLevel.
		const initialCalls = buildNotationChartMock.mock.calls.length;
		expect(initialCalls).toBeGreaterThanOrEqual(2);
		// Switch to the BASIC level via the select.
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: '3' } });
		// A level switch rebuilds the chart + reloads audio (two more calls).
		expect(buildNotationChartMock.mock.calls.length).toBe(initialCalls + 2);
	});

	it('toasts an error when some audio files fail to load', async () => {
		engineLoad.failedFiles = ['missing.wav'];
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
		render(PreviewPage);
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
	});

	it('falls back to visual-only playback on total audio failure', async () => {
		engineLoad.reject = true;
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
		render(PreviewPage);
		// The catch path disposes the engine and toasts, but keeps audioReady.
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		expect(engineSpies.dispose).toHaveBeenCalled();
	});

	it('toggles playback via the transport button (engine.play path)', async () => {
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
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

	it('toggles playback via the spacebar and ignores it for form controls', async () => {
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// Grab the button before toggling, while its label is still 'preview.play'.
		const playButton = screen.getByLabelText('preview.play');
		// Space on the window toggles play.
		await fireEvent.keyDown(window, { key: ' ', code: 'Space' });
		expect(engineSpies.play).toHaveBeenCalledTimes(1);
		// Space on a BUTTON target is ignored (native behavior preserved).
		await fireEvent.keyDown(playButton, { key: ' ', code: 'Space' });
		expect(engineSpies.play).toHaveBeenCalledTimes(1); // still 1, not 2
	});

	it('seeks via the notation onSeek handler', async () => {
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
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
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		parseFromRemoteURLMock.mockResolvedValue(makeSimFile());
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
