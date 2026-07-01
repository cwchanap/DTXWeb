// packages/common/src/lib/audio/previewAudioEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreviewAudioEngine } from './previewAudioEngine';
import { SoundChip } from '../chart/dtx';
import { LaneMeasureNote } from '../chart/note';
import type { ChartTiming } from '../notation/timing';

// A fake AudioContext capturing scheduled sources.
class FakeSource {
	buffer: unknown = null;
	onended: (() => void) | null = null;
	startedAt: number | null = null;
	startOffset: number | null = null;
	connect = vi.fn();
	start = vi.fn((when: number, offset?: number) => {
		this.startedAt = when;
		this.startOffset = offset ?? 0;
	});
	stop = vi.fn();
}
class FakeGain {
	gain = { value: 1 };
	connect = vi.fn();
}
class FakeContext {
	currentTime = 0;
	destination = {};
	state = 'running';
	sources: FakeSource[] = [];
	/** Duration reported by decoded buffers; tunable per test. */
	bufferDuration = 1;
	createBufferSource() {
		const s = new FakeSource();
		this.sources.push(s);
		return s;
	}
	createGain() {
		return new FakeGain();
	}
	createStereoPanner() {
		return { pan: { value: 0 }, connect: vi.fn() };
	}
	resume = vi.fn(async () => {});
	close = vi.fn(async () => {});
	decodeAudioData = vi.fn(
		async () => ({ duration: this.bufferDuration }) as unknown as AudioBuffer
	);
}

const timing: ChartTiming = {
	measureStartSeconds: [0, 2],
	totalDuration: 4,
	positionToTime: (m, f) => m * 2 + f * 2,
	timeToPosition: () => ({ measure: 0, fraction: 0 })
};

const makeChip = (id: number, fileName: string) => new SoundChip('', id, 100, 0, fileName);

describe('PreviewAudioEngine', () => {
	let ctx: FakeContext;
	let fetchFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		ctx = new FakeContext();
		fetchFn = vi.fn(async () => ({
			ok: true,
			arrayBuffer: async () => new ArrayBuffer(8)
		})) as unknown as ReturnType<typeof vi.fn>;
	});

	const load = (notesByLane: Record<string, LaneMeasureNote[]>, chips: SoundChip[]) =>
		new PreviewAudioEngine().load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: chips,
			notesByLane,
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});

	it('decodes each unique referenced file once', async () => {
		// noteID '02' -> base36 2 -> chip id 2
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '02', position: 0 },
			{ noteID: '02', position: 0.5 }
		]);
		const res = await load({ '12': [snare] }, [makeChip(2, 'snare.wav')]);
		expect(res.loaded).toBe(1);
		expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
		expect(res.failedFiles).toEqual([]);
	});

	it('resolves samples relative to chartFileUrl directory for nested charts', async () => {
		// Regression: a chart packaged under a subfolder (R2 key
		// `42/song/master.dtx`) must fetch `42/song/kick.wav`, not
		// `42/kick.wav`. Without chartFileUrl the engine falls back to
		// `${bucketUrl}/${simfileID}`, which 404s for nested charts.
		const kick = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const engine = new PreviewAudioEngine();
		const res = await engine.load({
			simfileID: '42',
			bucketUrl: 'https://b.test',
			chartFileUrl: 'https://b.test/42/song/master.dtx',
			soundChips: [makeChip(2, 'kick.wav')],
			notesByLane: { '12': [kick] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		expect(res.loaded).toBe(1);
		expect(fetchFn).toHaveBeenCalledWith('https://b.test/42/song/kick.wav');
	});

	it('strips query/hash from chartFileUrl when deriving the sample base', async () => {
		// Signed CDN URLs append `?X-Amz-Signature=...`; the sample base must
		// be derived from the path portion only.
		const kick = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const engine = new PreviewAudioEngine();
		await engine.load({
			simfileID: '42',
			bucketUrl: 'https://b.test',
			chartFileUrl: 'https://b.test/42/song/master.dtx?X-Amz-Signature=abc',
			soundChips: [makeChip(2, 'kick.wav')],
			notesByLane: { '12': [kick] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		expect(fetchFn).toHaveBeenCalledWith('https://b.test/42/song/kick.wav');
	});

	it('encodes URL-reserved characters in sample filenames', async () => {
		// A sample filename containing `#` (e.g. `snare#1.wav`) must be
		// percent-encoded before fetching. Without encoding, the browser treats
		// `#1.wav` as a URL fragment and never sends it to R2, so the sample is
		// reported missing even though the object exists. The API's toPublicUrl
		// encodes each path segment with encodeURIComponent; the engine must
		// match that to fetch the same URL the API publishes.
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const engine = new PreviewAudioEngine();
		await engine.load({
			simfileID: '42',
			bucketUrl: 'https://b.test',
			chartFileUrl: 'https://b.test/42/song/master.dtx',
			soundChips: [makeChip(2, 'snare#1.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		expect(fetchFn).toHaveBeenCalledWith('https://b.test/42/song/snare%231.wav');
	});

	it('encodes reserved characters in subdirectory sample paths', async () => {
		// A sample in a subfolder with a reserved char must encode each segment
		// independently, preserving the `/` separators (matching the API's
		// `key.split('/').map(encodeURIComponent).join('/')` pattern).
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const engine = new PreviewAudioEngine();
		await engine.load({
			simfileID: '42',
			bucketUrl: 'https://b.test',
			chartFileUrl: 'https://b.test/42/song/master.dtx',
			soundChips: [makeChip(2, 'drums/kick?2.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		expect(fetchFn).toHaveBeenCalledWith('https://b.test/42/song/drums/kick%3F2.wav');
	});

	it('falls back to ${bucketUrl}/${simfileID} when chartFileUrl is omitted', async () => {
		// Backward compat: callers that do not supply chartFileUrl keep the
		// legacy sample path resolution.
		const kick = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const engine = new PreviewAudioEngine();
		await engine.load({
			simfileID: '42',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'kick.wav')],
			notesByLane: { '12': [kick] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		expect(fetchFn).toHaveBeenCalledWith('https://b.test/42/kick.wav');
	});

	it('reports files that fail to fetch without throwing', async () => {
		fetchFn.mockResolvedValueOnce({ ok: false, status: 404 });
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const res = await load({ '12': [snare] }, [makeChip(2, 'missing.wav')]);
		expect(res.failedFiles).toEqual(['missing.wav']);
		expect(res.loaded).toBe(0);
	});

	it('limits concurrent sample fetches to the cap (4)', async () => {
		// Spec: "Concurrency-limited". Bare Promise.all would fire every unique
		// sample at once. With 8 unique files and a cap of 4, at most 4 fetches
		// may be in flight simultaneously. Because there are exactly 4 workers
		// and each holds at most one outstanding fetch, maxInFlight cannot exceed
		// 4 — and it reaches 4 since all workers enter fetch synchronously.
		const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => `${n}.wav`);
		// noteIDs '02'..'09' -> base-36 ids 2..9, each mapped to a distinct chip.
		const laneNotes: LaneMeasureNote[] = files.map((_, idx) => {
			const noteID = (idx + 2).toString(36).padStart(2, '0');
			return new LaneMeasureNote(0, '12', [{ noteID, position: 0 }]);
		});
		const chips = files.map((name, idx) => makeChip(idx + 2, name));

		let inFlight = 0;
		let maxInFlight = 0;
		let callCount = 0;
		const concurrencyFetch = ((url: string) => {
			callCount += 1;
			inFlight += 1;
			if (inFlight > maxInFlight) maxInFlight = inFlight;
			// Auto-resolve so load() completes; decrement when the fetch settles.
			return Promise.resolve({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(8)
			}).finally(() => {
				inFlight -= 1;
			});
		}) as unknown as typeof fetch;

		const res = await new PreviewAudioEngine().load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: chips,
			notesByLane: { '12': laneNotes },
			timing,
			fetchFn: concurrencyFetch,
			context: ctx as unknown as never
		});
		expect(res.loaded).toBe(8);
		expect(res.failedFiles).toEqual([]);
		expect(callCount).toBe(8); // every file still fetched
		expect(maxInFlight).toBe(4); // capped, never reached 8
	});

	it('reports a file as failed (no crash) if the engine is disposed mid-load', async () => {
		// Race: load() awaits fetch -> arrayBuffer -> decode(). If dispose()
		// nulls ctx while a fetch is in flight, decode()'s guard throws before
		// touching the nulled context, and fetchOne's catch reports the file as
		// failed rather than crashing with a null-deref or an unhandled rejection.
		const engine = new PreviewAudioEngine();
		let resolveFetch!: (value: {
			ok: boolean;
			arrayBuffer: () => Promise<ArrayBuffer>;
		}) => void;
		const deferred = new Promise((r) => {
			resolveFetch = r as typeof resolveFetch;
		});
		const controllableFetch = vi.fn(() => deferred) as unknown as typeof fetch;
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);

		const loadPromise = engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: controllableFetch,
			context: ctx as unknown as never
		});

		// Dispose while the fetch is still pending -> ctx becomes null.
		engine.dispose();
		resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

		const res = await loadPromise;
		expect(res.loaded).toBe(0);
		expect(res.failedFiles).toEqual(['snare.wav']);
		// The guard short-circuited before decodeAudioData ran on the nulled ctx.
		expect(ctx.decodeAudioData).not.toHaveBeenCalled();
	});

	it('schedules sources just-in-time via lookahead and tracks currentTime', async () => {
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '02', position: 0 },
			{ noteID: '02', position: 0.5 } // -> t = 1s
		]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			// Only the imminent note (t=0) is within the 0.5s lookahead horizon;
			// the t=1 note is not scheduled yet (this is what keeps the node graph
			// small enough that ctx.currentTime does not stall).
			expect(ctx.sources.length).toBe(1);
			ctx.currentTime = 0.5;
			expect(engine.currentTime).toBeCloseTo(0.5);
			// Advancing the clock past the horizon and ticking schedules the later note.
			ctx.currentTime = 1;
			vi.advanceTimersByTime(150);
			expect(ctx.sources.length).toBe(2);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('seek sets currentTime when paused', async () => {
		const engine = new PreviewAudioEngine();
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }])] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		engine.seek(1.5);
		expect(engine.currentTime).toBeCloseTo(1.5);
	});
});

describe('PreviewAudioEngine coverage', () => {
	let ctx: FakeContext;
	let fetchFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		ctx = new FakeContext();
		fetchFn = vi.fn(async () => ({
			ok: true,
			arrayBuffer: async () => new ArrayBuffer(8)
		})) as unknown as ReturnType<typeof vi.fn>;
	});

	const load = async (
		notesByLane: Record<string, LaneMeasureNote[]>,
		chips: SoundChip[],
		context: unknown = ctx
	) =>
		new PreviewAudioEngine().load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: chips,
			notesByLane,
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: context as AudioContext
		});

	it('reports duration 0 and currentTime 0 before load (no ctx)', () => {
		const engine = new PreviewAudioEngine();
		expect(engine.duration).toBe(0);
		expect(engine.currentTime).toBe(0);
		// play() is a no-op without a context.
		engine.play(0);
		expect(engine.currentTime).toBe(0);
	});

	it('clamps the volume setter to [0, 1] and applies it to scheduled gains', async () => {
		// Capture created gain nodes so we can assert the applied master volume.
		const gains: FakeGain[] = [];
		class CapturingContext extends FakeContext {
			createGain() {
				const g = new FakeGain();
				gains.push(g);
				return g;
			}
		}
		const cctx = new CapturingContext();
		const engine = new PreviewAudioEngine();
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }])] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: cctx as unknown as never
		});
		// Out-of-range values must clamp, not throw (exercises both clamp branches).
		engine.volume = 2; // -> 1
		engine.volume = -1; // -> 0
		engine.volume = 0.5;
		vi.useFakeTimers();
		try {
			engine.play(0);
			// event.gain = chip.volume(100)/100 = 1; master = 0.5 -> gain.value 0.5.
			expect(gains.at(-1)!.gain.value).toBeCloseTo(0.5);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('decodes .xa files via the context directly', async () => {
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await load({ '12': [snare] }, [makeChip(2, 'bgm.xa')]);
		// .xa branch calls ctx.decodeAudioData directly (one call for one file).
		expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
	});

	it('skips non-audio lanes (bpm/measure-length), "00" notes, and chips missing a fileName', async () => {
		// '08' = bpm, '02' = measure length -> not in AUDIO_LANES whitelist.
		// '12' has a '00' note (skipped) and an '01' note whose chip has no file.
		const bpm = new LaneMeasureNote(0, '08', [{ noteID: 'AA', position: 0 }]);
		const meas = new LaneMeasureNote(0, '02', [{ noteID: '01', position: 0 }]);
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '00', position: 0 },
			{ noteID: '01', position: 0 }
		]);
		// Chip id 1 (noteID '01') with an empty fileName -> skipped.
		const chipNoFile = new SoundChip('', 1, 100, 0, '');
		const res = await load({ '08': [bpm], '02': [meas], '12': [snare] }, [chipNoFile]);
		expect(res.loaded).toBe(0); // no playable events -> nothing fetched
	});

	it('skips legacy bpm channel 03 so hex tempo values are not played as samples', async () => {
		// Channel 03 noteIDs are hex BPM values (e.g. '0A' = 10). Without the
		// whitelist, noteID '0A' would resolve to chip id 10 (parseInt('0A', 36))
		// and play #WAV0A as audio. With the whitelist, the lane is ignored entirely.
		const legacyBpm = new LaneMeasureNote(0, '03', [{ noteID: '0A', position: 0 }]);
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		// Chip id 10 would match noteID '0A' if channel 03 were not excluded.
		const chipFor0A = makeChip(10, 'should-not-play.wav');
		const snareChip = makeChip(2, 'snare.wav');
		const res = await load({ '03': [legacyBpm], '12': [snare] }, [chipFor0A, snareChip]);
		expect(res.loaded).toBe(1); // only snare.wav fetched
		expect(res.failedFiles).toEqual([]);
	});

	it('skips BGA lanes (04/07) so #BMP noteIDs do not play unrelated #WAV samples', async () => {
		// DTX BGA channels 04/07 reference #BMP (image) IDs, not #WAV (audio)
		// IDs. The #BMP and #WAV namespaces are independent and can overlap:
		// a BGA noteID '05' means "show #BMP05", not "play #WAV05". Without
		// the whitelist, the engine would resolve BGA noteIDs through the
		// #WAV chip map and play unrelated audio for visual events.
		const bga04 = new LaneMeasureNote(0, '04', [{ noteID: '05', position: 0 }]);
		const bga07 = new LaneMeasureNote(0, '07', [{ noteID: '02', position: 0 }]);
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		// #WAV02 and #WAV05 exist; BGA lanes must NOT trigger them.
		const chip02 = makeChip(2, 'snare.wav');
		const chip05 = makeChip(5, 'bga-collision.wav');
		const res = await load({ '04': [bga04], '07': [bga07], '12': [snare] }, [chip02, chip05]);
		expect(res.loaded).toBe(1); // only snare.wav fetched
		expect(res.failedFiles).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining('bga-collision.wav'));
	});

	it('defaults chip volume/position to 100/0 when undefined', async () => {
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const chip = new SoundChip(
			'',
			2,
			undefined as unknown as number,
			undefined as unknown as number,
			'snare.wav'
		);
		const res = await load({ '12': [snare] }, [chip]);
		expect(res.loaded).toBe(1);
	});

	it('starts a still-sounding BGM source at a buffer offset when resuming mid-chart', async () => {
		ctx.bufferDuration = 10; // long BGM buffer
		const engine = new PreviewAudioEngine();
		// Event at t=0 (BGM). Resume playback at 1s: the BGM began before the
		// offset but is still sounding, so it must start at buffer offset 1.
		const bgm = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'bgm.wav')],
			notesByLane: { '12': [bgm] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(1);
			const bgmSource = ctx.sources[0];
			expect(bgmSource.startOffset).toBe(1); // started at buffer offset 1
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('fires onEnded and stops playback when the chart duration elapses', async () => {
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		const onEnded = vi.fn();
		engine.onEnded = onEnded;
		vi.useFakeTimers();
		try {
			engine.play(0);
			expect(onEnded).not.toHaveBeenCalled();
			// End is now driven by the audio clock (no wall-clock end timer): a
			// tick before the AudioContext reaches the duration is a no-op.
			ctx.currentTime = 2;
			vi.advanceTimersByTime(100); // one scheduler tick
			expect(onEnded).not.toHaveBeenCalled();
			// Audio clock reaches the end -> the next tick detects
			// currentTime >= duration and fires onEnded exactly once.
			ctx.currentTime = 4;
			vi.advanceTimersByTime(100);
			expect(onEnded).toHaveBeenCalledTimes(1);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('lets sources scheduled near the end ring out naturally when onEnded fires', async () => {
		// Deliberate behavior: `duration` is the time of the last note, not the
		// end of its audio tail. A note scheduled within the final SCHEDULE_AHEAD
		// horizon (e.g. a crash cymbal at the chart's end) must NOT be hard-stopped
		// when the transport reaches `duration` — otherwise the final hit would be
		// chopped the instant it starts. This test locks that decision in so a
		// future "strict stop" change can't regress it silently.
		const engine = new PreviewAudioEngine();
		// Note at measure 1, fraction 0.9 -> t = 1*2 + 0.9*2 = 3.8s (within the
		// 0.5s horizon of totalDuration=4).
		const crash = new LaneMeasureNote(1, '12', [{ noteID: '02', position: 0.9 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'crash.wav')],
			notesByLane: { '12': [crash] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		const onEnded = vi.fn();
		engine.onEnded = onEnded;
		vi.useFakeTimers();
		try {
			engine.play(0);
			// Advance the clock so the lookahead horizon covers t=3.8 and the
			// crash source is scheduled.
			ctx.currentTime = 3.3;
			vi.advanceTimersByTime(100);
			expect(ctx.sources.length).toBe(1);
			const crashSource = ctx.sources[0];
			// Reach the end -> onEnded fires, but the scheduled crash must keep
			// ringing (no stopSources() in the end branch).
			ctx.currentTime = 4;
			vi.advanceTimersByTime(100);
			expect(onEnded).toHaveBeenCalledTimes(1);
			expect(crashSource.stop).not.toHaveBeenCalled();
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('stops BGM backing sources at the transport end but lets drum tails ring', async () => {
		// A channel 01 BGM buffer that extends past `totalDuration` (fade-out,
		// trailing silence) must be stopped when the transport ends — otherwise
		// it keeps playing for seconds after the UI reports "ended", diverging
		// from the transport. One-shot drum hits near the end (a crash cymbal)
		// must still ring out naturally. This locks the BGM-stop / drum-ring
		// distinction in so a future change can't regress either side.
		ctx.bufferDuration = 10; // BGM buffer extends past totalDuration=4
		const engine = new PreviewAudioEngine();
		const bgm = new LaneMeasureNote(0, '01', [{ noteID: '02', position: 0 }]);
		// Crash at measure 1, fraction 0.9 -> t = 3.8s (within the 0.5s horizon).
		const crash = new LaneMeasureNote(1, '12', [{ noteID: '03', position: 0.9 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'bgm.wav'), makeChip(3, 'crash.wav')],
			notesByLane: { '01': [bgm], '12': [crash] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		const onEnded = vi.fn();
		engine.onEnded = onEnded;
		vi.useFakeTimers();
		try {
			engine.play(0);
			// BGM (t=0) is scheduled within the first tick; crash (t=3.8) is not.
			expect(ctx.sources.length).toBe(1);
			const bgmSource = ctx.sources[0];
			// Advance so the lookahead horizon covers t=3.8 and the crash schedules.
			ctx.currentTime = 3.3;
			vi.advanceTimersByTime(100);
			expect(ctx.sources.length).toBe(2);
			const crashSource = ctx.sources[1];
			// Reach the end -> onEnded fires. The BGM backing track is stopped
			// (it would otherwise ring past the transport), but the crash tail
			// keeps decaying naturally.
			ctx.currentTime = 4;
			vi.advanceTimersByTime(100);
			expect(onEnded).toHaveBeenCalledTimes(1);
			expect(bgmSource.stop).toHaveBeenCalledTimes(1);
			expect(crashSource.stop).not.toHaveBeenCalled();
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('prunes finished sources from the active set via onended', async () => {
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			const source = ctx.sources[0];
			// Simulate the source finishing: its onended prunes it from active.
			source.onended!();
			engine.dispose();
			// A pruned source is no longer in `active`, so dispose's stopSources
			// must NOT call stop on it.
			expect(source.stop).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('pause captures currentTime and halts scheduling', async () => {
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			ctx.currentTime = 1.5; // advance the audio clock
			engine.pause();
			// While paused, currentTime reports the captured offset (not the live clock).
			expect(engine.currentTime).toBeCloseTo(1.5);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('seek while playing restarts playback from the new offset', async () => {
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			engine.seek(2);
			expect(engine.currentTime).toBeCloseTo(2);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('resume() is called when the context starts suspended', async () => {
		ctx.state = 'suspended';
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			expect(ctx.resume).toHaveBeenCalledTimes(1);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});

	it('stopSources swallows errors from already-stopped sources', async () => {
		// A context whose sources throw on stop() (e.g. already stopped).
		class ThrowingSource extends FakeSource {
			stop = vi.fn(() => {
				throw new Error('already stopped');
			});
		}
		class ThrowingContext extends FakeContext {
			createBufferSource() {
				const s = new ThrowingSource();
				this.sources.push(s);
				return s;
			}
		}
		const tctx = new ThrowingContext();
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: tctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			// dispose -> stopSources must not throw despite the throwing source.
			expect(() => engine.dispose()).not.toThrow();
		} finally {
			vi.useRealTimers();
		}
	});

	it('reload() on the same instance tears down prior playback state', async () => {
		// Verify load() is self-cleaning: after playing, a second load() on the
		// same engine must stop the old sources, clear the scheduler, and drop the
		// old context so nothing leaks across a reload.
		const engine = new PreviewAudioEngine();
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		await engine.load({
			simfileID: '5',
			bucketUrl: 'https://b.test',
			soundChips: [makeChip(2, 'snare.wav')],
			notesByLane: { '12': [snare] },
			timing,
			fetchFn: fetchFn as unknown as typeof fetch,
			context: ctx as unknown as never
		});
		vi.useFakeTimers();
		try {
			engine.play(0);
			expect(ctx.sources.length).toBe(1);
			const firstSource = ctx.sources[0];
			// Reusing the same engine + context for a reload must stop the active
			// source from the first load before scheduling the new one.
			await engine.load({
				simfileID: '5',
				bucketUrl: 'https://b.test',
				soundChips: [makeChip(2, 'snare.wav')],
				notesByLane: { '12': [snare] },
				timing,
				fetchFn: fetchFn as unknown as typeof fetch,
				context: ctx as unknown as never
			});
			expect(firstSource.stop).toHaveBeenCalled();
			// Playback state was reset by load(); currentTime reports the offset, not
			// the old playing clock.
			expect(engine.currentTime).toBe(0);
		} finally {
			engine.dispose();
			vi.useRealTimers();
		}
	});
});
