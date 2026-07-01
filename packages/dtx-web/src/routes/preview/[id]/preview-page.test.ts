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
// Per-instance tracking so the rapid-level-switch interleaving test can
// resolve a specific hung load and assert which engine got disposed. Each
// entry is populated when its load() promise executor runs.
const engineInstances = vi.hoisted(
	() =>
		[] as Array<{
			disposeCalls: number;
			resolve: (r: { loaded: number; failedFiles: string[] }) => void;
			reject: (e: Error) => void;
		}>
);
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
	buildNotationChart: buildNotationChartMock
}));
vi.mock('@dtx/common/audio', () => ({
	PreviewAudioEngine: class {
		onEnded?: () => void;
		private readonly idx: number;
		constructor() {
			engineRef.current = this;
			this.idx = engineInstances.length;
			engineInstances.push({ disposeCalls: 0, resolve: () => {}, reject: () => {} });
		}
		async load() {
			if (engineLoad.reject) throw new Error('audio failure');
			if (engineLoad.hang) {
				// Per-instance deferred so a test can resolve/reject one specific
				// hung load (e.g. to fire the superseded bail path).
				return new Promise<{ loaded: number; failedFiles: string[] }>((resolve, reject) => {
					engineInstances[this.idx].resolve = resolve;
					engineInstances[this.idx].reject = reject;
				});
			}
			return { loaded: 0, failedFiles: engineLoad.failedFiles };
		}
		play = engineSpies.play;
		pause = engineSpies.pause;
		// Mirror the real engine: seek() sets startOffset, and currentTime
		// returns startOffset at rest. Tests that assert play(currentTime)
		// after a seek need the mock to reflect this.
		seek = (seconds: number) => {
			engineState.currentTime = seconds;
			engineSpies.seek(seconds);
		};
		dispose = () => {
			engineInstances[this.idx].disposeCalls += 1;
			engineSpies.dispose();
		};
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
// Reactive page store so tests can simulate in-app navigation between
// /preview/[id] routes (SvelteKit reuses the component across id changes).
// `setRouteId` updates the captured id and notifies all subscribers, mirroring
// how $page updates on navigation.
const pageSubscribers = new Set<(v: unknown) => void>();
const emitPage = () => {
	const value = {
		url: new URL(`https://app.test/preview/${routeId ?? ''}`),
		params: { id: routeId ?? '' }
	};
	for (const fn of pageSubscribers) fn(value);
};
const setRouteId = (id: string | null) => {
	routeId = id;
	emitPage();
};
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (v: unknown) => void) => {
			pageSubscribers.add(run);
			run({
				url: new URL(`https://app.test/preview/${routeId ?? ''}`),
				params: { id: routeId ?? '' }
			});
			return () => {
				pageSubscribers.delete(run);
			};
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
		engineInstances.length = 0;
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
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		// A level switch fetches the new DTXFile then rebuilds the chart once
		// (a single buildNotationChart call). The fetch is async, so wait for
		// the build to land.
		await waitFor(() =>
			expect(buildNotationChartMock.mock.calls.length).toBe(initialCalls + 1)
		);
	});

	it('pauses the playing engine immediately when switching levels', async () => {
		// Regression: the UI transport stopped on level switch but the audio
		// engine kept sounding until the new chart's DTX fetch resolved. The fix
		// pauses the active engine before the async fetch so playback is silenced
		// the moment the user changes levels.
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
		engineSpies.pause.mockClear();
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		// engine.pause() fires synchronously before the async DTX fetch, so no
		// waitFor is needed — it is called during the change event handling.
		expect(engineSpies.pause).toHaveBeenCalledTimes(1);
	});

	it('reverts the level dropdown and keeps the old chart when the level fetch fails', async () => {
		// Regression: selectedFileUrl is set eagerly when the dropdown changes,
		// so on a fetch failure it must snap back to the level the still-visible
		// chart was built for. Otherwise the select advertises a level the
		// notation area is not showing.
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
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		// load() picks the highest level (MASTER) after sorting levels desc, so
		// the select binds to its fileUrl.
		expect(select.value).toBe('https://bucket.test/5/master.dtx');
		const buildsBefore = buildNotationChartMock.mock.calls.length;
		// Flip the DTX fetch to fail for the level switch (initial load already
		// resolved, so resetting here only affects the change handler).
		parseLevelFromRemoteURLMock.mockRejectedValue(new Error('network down'));
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		// Chart-fetch failure toasts with the dedicated message...
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		expect(toastError).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'preview.level_load_failed' })
		);
		// ...the dropdown reverts to the still-displayed MASTER level...
		expect(select.value).toBe('https://bucket.test/5/master.dtx');
		// ...and the chart is NOT rebuilt (old notation stays in place).
		expect(buildNotationChartMock.mock.calls.length).toBe(buildsBefore);
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

	it('disposes a superseded engine when its load resolves after a newer level switch', async () => {
		// Regression for the bail-path dispose fix: when a level switch starts a
		// newer load while an older load is still in flight, the older load's
		// localEngine must be disposed when it eventually resolves and bails on
		// the generation guard. Without the fix, only the newer load's
		// engine?.dispose() call touched the old engine, leaving the bail path
		// dependent on that external disposal (not self-contained).
		engineLoad.hang = true; // per-instance deferred loads
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
		// Initial load (engine 0, MASTER) is hanging on a deferred promise.
		expect(engineInstances.length).toBe(1);
		// Switch to BASIC: starts engine 1 and disposes engine 0 via the
		// engine?.dispose() call at the top of loadAudioForLevel.
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		await waitFor(() => expect(engineInstances.length).toBe(2));
		expect(engineInstances[0].disposeCalls).toBe(1); // disposed by engine 1's setup
		expect(engineInstances[1].disposeCalls).toBe(0); // current engine, not disposed
		// Resolve engine 0's hung load -> it hits the superseded bail path. The
		// fix disposes localEngine (engine 0) before returning; without the fix
		// this second dispose would not happen.
		engineInstances[0].resolve({ loaded: 0, failedFiles: [] });
		await waitFor(() => expect(engineInstances[0].disposeCalls).toBe(2));
		// The current engine (engine 1) is untouched by the bail.
		expect(engineInstances[1].disposeCalls).toBe(0);
	});

	it('disposes a superseded engine when its load rejects after a newer level switch', async () => {
		// Same interleaving as above, but the superseded load rejects and hits
		// the catch-path bail. The fix must dispose there too.
		engineLoad.hang = true;
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
		expect(engineInstances.length).toBe(1);
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		await waitFor(() => expect(engineInstances.length).toBe(2));
		// Reject engine 0's hung load -> catch-path bail must dispose it.
		engineInstances[0].reject(new Error('network failure'));
		await waitFor(() => expect(engineInstances[0].disposeCalls).toBeGreaterThanOrEqual(2));
		// The superseded failure must NOT toast (only the current engine's
		// failure path toasts). Engine 1 is still hanging, so no toast yet.
		expect(toastError).not.toHaveBeenCalled();
	});

	it('selects either chart when two levels share the same numeric level', async () => {
		// Regression: the level dropdown keyed <option>s and the selection by
		// numeric `level`. Two dtx_files rows with the same level (e.g. two
		// MASTER charts) collapsed to a single selectable entry — the second
		// chart could never be loaded because levels.find(l => l.level === X)
		// always returns the first match. The API documents (label, level) as
		// non-unique (it resolves charts by row index), so the preview must key
		// by the unique fileUrl instead.
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [
				{ level: 4, label: 'MASTER-A', fileUrl: 'https://bucket.test/5/master-a.dtx' },
				{ level: 4, label: 'MASTER-B', fileUrl: 'https://bucket.test/5/master-b.dtx' }
			]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		// Both duplicate-level charts are present with DISTINCT option values
		// (previously both options had value="4" so the second was unreachable).
		expect(Array.from(select.options).map((o) => o.value)).toEqual([
			'https://bucket.test/5/master-a.dtx',
			'https://bucket.test/5/master-b.dtx'
		]);
		// Selecting the second duplicate-level chart actually fetches + rebuilds
		// it (buildNotationChart runs again for the newly selected fileUrl).
		const buildsBefore = buildNotationChartMock.mock.calls.length;
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/master-b.dtx' } });
		await waitFor(() =>
			expect(buildNotationChartMock.mock.calls.length).toBe(buildsBefore + 1)
		);
		expect(select.value).toBe('https://bucket.test/5/master-b.dtx');
	});

	it('keeps playback working when a level fetch fails mid audio-load', async () => {
		// Regression: handleLevelChange used to bump loadGeneration at the start
		// of the switch, which invalidated the previous level's in-flight audio
		// load (its engine got disposed on the bail path when the load later
		// resolved). When the new level's DTX fetch then failed, the revert path
		// re-enabled audioReady even though `engine` still pointed at the
		// disposed engine — so Play would no-op on a dead engine. The fix
		// delays the generation bump until the fetch has succeeded.
		engineLoad.hang = true; // initial MASTER audio load hangs in-flight
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
		expect(engineInstances.length).toBe(1); // MASTER engine hanging on deferred load
		// Make the BASIC chart fetch fail, then start the switch.
		parseLevelFromRemoteURLMock.mockRejectedValue(new Error('network down'));
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		// While the fetch is in flight, resolve MASTER's hung audio load. With
		// the buggy early generation bump this would trip the bail path and
		// dispose engine 0; with the fix the load completes normally.
		engineInstances[0].resolve({ loaded: 0, failedFiles: [] });
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'preview.level_load_failed' })
			)
		);
		// The dropdown reverts to MASTER...
		expect(select.value).toBe('https://bucket.test/5/master.dtx');
		// ...and the MASTER engine is still alive (not disposed by a premature
		// generation bump). Under the old code disposeCalls would be >= 1 here.
		expect(engineInstances[0].disposeCalls).toBe(0);
		// ...so Play now drives a LIVE engine instead of no-op'ing on a dead one.
		const playButton = await screen.findByLabelText('preview.play');
		await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
		engineSpies.play.mockClear();
		await fireEvent.click(playButton);
		expect(engineSpies.play).toHaveBeenCalledTimes(1);
	});

	it('ignores a stale level switch superseded by a newer switch before fetch returns', async () => {
		// Regression: two rapid level switches shared the same priorGeneration
		// (loadGeneration is only bumped on successful commit). The first
		// switch's fetch could return and commit its chart/audio after
		// selectedFileUrl already pointed at the second selection, leaving the
		// dropdown and rendered notation on different levels. The switchToken
		// guard ensures the stale (first) switch bails without committing.
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [
				{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' },
				{ level: 3, label: 'BASIC', fileUrl: 'https://bucket.test/5/basic.dtx' },
				{ level: 2, label: 'ADVANCED', fileUrl: 'https://bucket.test/5/advanced.dtx' }
			]
		});
		render(PreviewPage);
		// Wait for the initial load to complete (its fetch resolves normally).
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// Now switch to deferred DTX fetches so we can interleave two switches.
		const fetchDeferred: Array<{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
		}> = [];
		parseLevelFromRemoteURLMock.mockImplementation(() => {
			return new Promise((resolve, reject) => {
				fetchDeferred.push({ resolve, reject });
			});
		});
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		// Switch to BASIC (fetch 0 hangs), then immediately switch to ADVANCED
		// (fetch 1 hangs). Both share the same priorGeneration.
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/advanced.dtx' } });
		expect(fetchDeferred).toHaveLength(2);
		const buildsBefore = buildNotationChartMock.mock.calls.length;
		// Resolve the FIRST switch (BASIC) — it must NOT commit because the
		// switchToken has moved on to the ADVANCED switch.
		fetchDeferred[0].resolve(makeDtx());
		// Give the microtask queue a tick to process the stale resolution.
		await new Promise((r) => setTimeout(r, 10));
		// No new chart build from the stale BASIC switch.
		expect(buildNotationChartMock.mock.calls.length).toBe(buildsBefore);
		// The dropdown still shows ADVANCED (the current selection).
		expect(select.value).toBe('https://bucket.test/5/advanced.dtx');
		// Now resolve the SECOND switch (ADVANCED) — it SHOULD commit.
		fetchDeferred[1].resolve(makeDtx());
		await waitFor(() =>
			expect(buildNotationChartMock.mock.calls.length).toBe(buildsBefore + 1)
		);
		expect(select.value).toBe('https://bucket.test/5/advanced.dtx');
	});

	it('keeps audioReady false on failed level switch while previous audio is still loading', async () => {
		// Regression: handleLevelChange unconditionally set audioReady=true on
		// fetch failure, even if the previous level's audio was still loading.
		// This enabled Play against a partially loaded engine. The fix restores
		// the previous audioReady state (false when audio was still loading).
		engineLoad.hang = true; // initial MASTER audio load hangs in-flight
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
		// MASTER audio is still loading (hung), so audioReady is false.
		expect(engineInstances.length).toBe(1);
		// Make the BASIC chart fetch fail, then start the switch.
		parseLevelFromRemoteURLMock.mockRejectedValue(new Error('network down'));
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'https://bucket.test/5/basic.dtx' } });
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'preview.level_load_failed' })
			)
		);
		// The dropdown reverts to MASTER...
		expect(select.value).toBe('https://bucket.test/5/master.dtx');
		// ...but audioReady must stay false because MASTER's audio is STILL
		// loading — the transport must not enable Play on a partially loaded
		// engine.
		const playButton = screen.getByLabelText('preview.audio_loading') as HTMLButtonElement;
		expect(playButton.disabled).toBe(true);
		// Now resolve MASTER's hung audio load — audioReady becomes true.
		engineInstances[0].resolve({ loaded: 0, failedFiles: [] });
		await waitFor(() =>
			expect((screen.getByLabelText('preview.play') as HTMLButtonElement).disabled).toBe(
				false
			)
		);
	});

	it('preserves seek position when audio finishes loading after a seek', async () => {
		// Regression: clicking the notation before audio finished loading only
		// updated the wall-clock visual state (handleSeek's else branch) without
		// calling engine.seek(). When audio then became ready, pressing Play used
		// engine.currentTime (still 0), so playback jumped to the beginning
		// instead of the visible cursor position. The fix syncs the engine to the
		// current visual position when audio finishes loading.
		engineLoad.hang = true;
		// positionToTime must yield a non-zero seek target so we can distinguish
		// a preserved seek (1.0) from the default (0). The stub seeks to
		// { measure: 0, fraction: 0.5 }, so 0.5 * 2 = 1.0 second.
		const baseChart = readyChart();
		buildNotationChartMock.mockReturnValue({
			...baseChart,
			timing: {
				...baseChart.timing,
				positionToTime: (_m: number, f: number) => f * 2
			}
		});
		getPreviewSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
		// Audio is still loading (hung), so handleSeek takes the wall-clock
		// branch — engine.seek() is NOT called here.
		const seekButton = screen.getByTestId('stub-seek');
		await fireEvent.click(seekButton);
		expect(engineSpies.seek).not.toHaveBeenCalled();
		// Resolve the hung audio load -> audioReady becomes true and the fix
		// syncs the engine to the current visual position (1.0s).
		engineInstances[0].resolve({ loaded: 0, failedFiles: [] });
		const playButton = await screen.findByLabelText('preview.play');
		await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
		expect(engineSpies.seek).toHaveBeenCalledWith(1.0);
		// Pressing play must resume from the preserved position, not 0.
		engineSpies.play.mockClear();
		await fireEvent.click(playButton);
		expect(engineSpies.play).toHaveBeenCalledWith(1.0);
	});

	it('ignores a stale DTX fetch error after navigating to a different chart', async () => {
		// Regression: when navigating between /preview/[id] routes while the
		// previous chart's DTX fetch was still in flight, the old fetch could
		// reject and set status='error' AFTER $page.params.id had moved to the
		// new chart. The success path already guarded with `id !== $page.params.id`,
		// but the error branch (and the surrounding catch) did not — so a failed
		// old chart replaced the new page's loading state with
		// 'preview.not_available'. The fix hoists the stale-route guard above
		// the error assignment and adds it to the catch path.
		// Both charts' getPreviewSimfile AND DTX fetches are deferred so we can
		// interleave: the old chart's DTX fetch must reject while the new
		// chart's getPreviewSimfile is still in flight (before the new load
		// bumps loadGeneration). Otherwise fetchLevelDtx's generation guard
		// would return null instead of 'error' and the bug wouldn't trigger.
		const metaDeferred: Array<{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
		}> = [];
		const fetchDeferred: Array<{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
		}> = [];
		getPreviewSimfileMock.mockImplementation(() => {
			return new Promise((resolve, reject) => {
				metaDeferred.push({ resolve, reject });
			});
		});
		parseLevelFromRemoteURLMock.mockImplementation(() => {
			return new Promise((resolve, reject) => {
				fetchDeferred.push({ resolve, reject });
			});
		});
		render(PreviewPage);
		// id 5: resolve getPreviewSimfile so its DTX fetch starts (and hangs).
		await waitFor(() => expect(metaDeferred).toHaveLength(1));
		metaDeferred[0].resolve({
			id: 5,
			title: 'Song A',
			artist: 'Artist A',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/5/master.dtx' }]
		});
		await waitFor(() => expect(fetchDeferred).toHaveLength(1));
		// Navigate to id 6 while id-5's DTX fetch is still hanging. The new
		// load()'s getPreviewSimfile is deferred, so loadGeneration has NOT been
		// bumped yet — this is the window where the bug triggers.
		setRouteId('6');
		await waitFor(() => expect(metaDeferred).toHaveLength(2));
		expect(screen.getByText('preview.loading')).toBeTruthy();
		// Now the OLD chart's DTX fetch rejects. Inside fetchLevelDtx the
		// generation guard sees generation === loadGeneration (the new load
		// hasn't bumped it yet), so it returns 'error' rather than null.
		// Without the fix, the error branch sets status='error' on the new page.
		fetchDeferred[0].reject(new Error('stale chart network failure'));
		await new Promise((r) => setTimeout(r, 10));
		// The new page must STILL be loading, NOT showing the error state from
		// the old chart's failure.
		expect(screen.queryByText('preview.not_available')).toBeNull();
		// Resolve the new chart's getPreviewSimfile -> it bumps loadGeneration,
		// starts its DTX fetch, and on resolution becomes ready.
		metaDeferred[1].resolve({
			id: 6,
			title: 'Song B',
			artist: 'Artist B',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/6/master.dtx' }]
		});
		await waitFor(() => expect(fetchDeferred).toHaveLength(2));
		fetchDeferred[1].resolve(makeDtx());
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
	});

	it('ignores a stale getPreviewSimfile rejection after navigating to a different chart', async () => {
		// Regression for the catch-path guard: if getPreviewSimfile (or any
		// earlier await in load()) rejects after navigation has moved on to a
		// new id, the catch must not clobber the new page's state with
		// 'preview.not_available'.
		// Both charts' getPreviewSimfile calls are deferred so we can control
		// their resolution order and deliver the stale rejection after
		// navigation.
		const metaDeferred: Array<{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
		}> = [];
		getPreviewSimfileMock.mockImplementation(() => {
			return new Promise((resolve, reject) => {
				metaDeferred.push({ resolve, reject });
			});
		});
		render(PreviewPage);
		await waitFor(() => expect(metaDeferred).toHaveLength(1));
		// Navigate to a different chart (id 6) while id-5's getPreviewSimfile is
		// still hanging. The $effect re-runs load() for the new id, which pushes
		// a second deferred entry.
		setRouteId('6');
		await waitFor(() => expect(metaDeferred).toHaveLength(2));
		expect(screen.getByText('preview.loading')).toBeTruthy();
		// The OLD chart's getPreviewSimfile rejects. Without the catch-path
		// guard this would set status='error' on the new page.
		metaDeferred[0].reject(new Error('stale meta failure'));
		await new Promise((r) => setTimeout(r, 10));
		// The new page must still be loading, not in the error state.
		expect(screen.queryByText('preview.not_available')).toBeNull();
		// Resolve the new chart's getPreviewSimfile -> it should become ready.
		metaDeferred[1].resolve({
			id: 6,
			title: 'Song B',
			artist: 'Artist B',
			levels: [{ level: 4, label: 'MASTER', fileUrl: 'https://bucket.test/6/master.dtx' }]
		});
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
	});
});
