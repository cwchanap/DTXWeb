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

	it('reports files that fail to fetch without throwing', async () => {
		fetchFn.mockResolvedValueOnce({ ok: false, status: 404 });
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }]);
		const res = await load({ '12': [snare] }, [makeChip(2, 'missing.wav')]);
		expect(res.failedFiles).toEqual(['missing.wav']);
		expect(res.loaded).toBe(0);
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

	it('skips bpm/measure-length lanes, "00" notes, and chips missing a fileName', async () => {
		// '08' = bpm, '02' = measure length -> skipped entirely.
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
			// duration is 4s; advance past the end timer.
			vi.advanceTimersByTime(4100);
			expect(onEnded).toHaveBeenCalledTimes(1);
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
});
