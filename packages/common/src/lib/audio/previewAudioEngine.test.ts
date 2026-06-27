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
	connect = vi.fn();
	start = vi.fn((when: number) => {
		this.startedAt = when;
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
	decodeAudioData = vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer);
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

	it('schedules a source per note on play() and tracks currentTime', async () => {
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
		engine.play(0);
		expect(ctx.sources.length).toBe(2);
		ctx.currentTime = 0.5;
		expect(engine.currentTime).toBeCloseTo(0.5);
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
