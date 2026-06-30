// packages/common/src/lib/audio/previewAudioEngine.ts
import { SoundChip } from '../chart/dtx';
import type { LaneMeasureNote } from '../chart/note';
import type { ChartTiming } from '../notation/timing';
import { XAAudioContext } from '../browser/audioDecoder';

const BPM_CHANNEL = '08';
const MEASURE_LENGTH_CHANNEL = '02';

/**
 * Derive the directory portion of a chart file URL for resolving `#WAV`
 * sample paths relative to the chart. Strips any query/hash first (R2/CDN
 * signed URLs append `?X-Amz-Signature=...`) and returns everything up to
 * (but not including) the final slash. Example:
 *   `https://b.test/42/song/master.dtx` -> `https://b.test/42/song`
 */
const deriveChartDir = (chartFileUrl: string): string => {
	const clean = chartFileUrl.split(/[?#]/)[0];
	const slashIdx = clean.lastIndexOf('/');
	return slashIdx >= 0 ? clean.slice(0, slashIdx) : '';
};

interface ScheduledEvent {
	timeSec: number;
	fileName: string;
	gain: number;
	pan: number;
}

export interface AudioEngineLoadParams {
	simfileID: string;
	bucketUrl: string;
	soundChips: SoundChip[];
	notesByLane: Record<string, LaneMeasureNote[]>;
	timing: ChartTiming;
	fetchFn?: typeof fetch;
	/** Injectable for tests. Defaults to a new XAAudioContext. */
	context?: AudioContext;
	/**
	 * Fully-qualified URL of the selected chart file (the catalog `fileUrl`).
	 * When provided, sample files referenced by `#WAV` are resolved relative
	 * to this file's directory — matching how DTX charts packaged under a
	 * subfolder reference their samples. Falls back to
	 * `${bucketUrl}/${simfileID}` for callers that do not supply it.
	 */
	chartFileUrl?: string;
}

export class PreviewAudioEngine {
	private ctx: AudioContext | null = null;
	private ownsContext = false;
	private buffers = new Map<string, AudioBuffer>();
	private events: ScheduledEvent[] = [];
	private active: AudioBufferSourceNode[] = [];
	private timing: ChartTiming | null = null;

	private playing = false;
	private startCtxTime = 0;
	private startOffset = 0;
	private masterVolume = 1;

	// Lookahead scheduler state. Creating every source node up front (thousands
	// for a full chart) overloads the Web Audio render thread and stalls
	// ctx.currentTime to a fraction of real time. Instead we create nodes
	// just-in-time, a small horizon ahead of the playback clock.
	private static readonly SCHEDULE_AHEAD_SEC = 0.5;
	private static readonly TICK_MS = 100;
	// Cap on parallel sample fetches during load. Bare Promise.all would fire
	// every unique sample at once, which the preview spec forbids
	// ("Concurrency-limited"). Matches the MAX_CONCURRENT_R2_FETCHES pattern in
	// zipBuilder. @dtx/common gains no new dependency, so this is an inline
	// worker pool rather than a p-limit import.
	private static readonly MAX_CONCURRENT_FETCHES = 4;
	private schedulerTimer: ReturnType<typeof setInterval> | null = null;
	private nextEventIdx = 0;

	onEnded?: () => void;

	get duration(): number {
		return this.timing?.totalDuration ?? 0;
	}

	get currentTime(): number {
		if (!this.ctx) return this.startOffset;
		if (!this.playing) return this.startOffset;
		return Math.min(this.duration, this.ctx.currentTime - this.startCtxTime + this.startOffset);
	}

	set volume(v: number) {
		this.masterVolume = Math.max(0, Math.min(1, v));
	}

	async load(params: AudioEngineLoadParams): Promise<{ loaded: number; failedFiles: string[] }> {
		// Tear down any playback state from a prior load so reusing the same
		// instance (e.g. a reload) does not leak sources/timers or keep an old
		// AudioContext running in the background. Today the page disposes + news
		// the engine per level switch, but load() must stay self-cleaning.
		this.stopSources();
		this.clearScheduler();
		if (this.ownsContext && this.ctx) void this.ctx.close();

		this.playing = false;
		this.startCtxTime = 0;
		this.startOffset = 0;
		this.nextEventIdx = 0;
		this.timing = params.timing;
		this.ctx = params.context ?? new XAAudioContext();
		this.ownsContext = !params.context;
		const doFetch = params.fetchFn ?? fetch;

		// Reset decoded buffers so a re-load (e.g. difficulty switch) reports an
		// accurate `loaded` count and does not retain buffers from a prior chart.
		this.buffers.clear();

		const chipById = new Map<number, SoundChip>();
		for (const chip of params.soundChips) chipById.set(chip.id, chip);

		// Build the schedule across every channel except bpm/measure-length.
		this.events = [];
		for (const [laneId, laneNotes] of Object.entries(params.notesByLane)) {
			if (laneId === BPM_CHANNEL || laneId === MEASURE_LENGTH_CHANNEL) continue;
			for (const measureNote of laneNotes) {
				for (const note of measureNote.notes) {
					if (note.noteID === '00') continue;
					const chip = chipById.get(parseInt(note.noteID, 36));
					if (!chip || !chip.fileName) continue;
					this.events.push({
						timeSec: params.timing.positionToTime(measureNote.measure, note.position),
						fileName: chip.fileName,
						gain: (chip.volume ?? 100) / 100,
						pan: Math.max(-1, Math.min(1, (chip.position ?? 0) / 100))
					});
				}
			}
		}
		this.events.sort((a, b) => a.timeSec - b.timeSec);

		const failedFiles: string[] = [];
		const uniqueNames = [...new Set(this.events.map((e) => e.fileName))];
		const sampleBaseUrl = params.chartFileUrl
			? deriveChartDir(params.chartFileUrl)
			: `${params.bucketUrl}/${params.simfileID}`;

		const fetchOne = async (fileName: string): Promise<void> => {
			try {
				const url = `${sampleBaseUrl}/${fileName}`;
				const res = await doFetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.arrayBuffer();
				const buffer = await this.decode(fileName, data);
				this.buffers.set(fileName, buffer);
			} catch {
				failedFiles.push(fileName);
			}
		};

		// Concurrency-limited worker pool so a chart with dozens of unique
		// samples does not fire them all at the browser/R2 simultaneously.
		let nextIndex = 0;
		const workerCount = Math.min(PreviewAudioEngine.MAX_CONCURRENT_FETCHES, uniqueNames.length);
		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (nextIndex < uniqueNames.length) {
					const i = nextIndex;
					nextIndex += 1;
					await fetchOne(uniqueNames[i]);
				}
			})
		);

		return { loaded: this.buffers.size, failedFiles };
	}

	private async decode(fileName: string, data: ArrayBuffer): Promise<AudioBuffer> {
		// ctx is created in load() and nulled in dispose(). decode() is only ever
		// called mid-load, so ctx should always exist — but fail explicitly rather
		// than crash inside decodeAudioData with a cryptic null-deref if the engine
		// was disposed concurrently.
		if (!this.ctx) throw new Error('PreviewAudioEngine.decode called after dispose');
		const ctx = this.ctx;
		if (fileName.toLowerCase().endsWith('.xa')) {
			return ctx.decodeAudioData(data);
		}
		// Native (non-XA) decode. A production XAAudioContext's decodeAudioData is
		// XA-only, so reach past its override to the native base method. Any other
		// injected context (tests, plain AudioContext) decodes natively itself.
		if (ctx instanceof XAAudioContext) {
			return AudioContext.prototype.decodeAudioData.call(ctx, data) as Promise<AudioBuffer>;
		}
		return ctx.decodeAudioData(data);
	}

	play(fromSeconds?: number): void {
		if (!this.ctx) return;
		if (fromSeconds !== undefined) this.startOffset = fromSeconds;
		if (this.ctx.state === 'suspended') void this.ctx.resume();

		this.stopSources();
		this.clearScheduler();
		this.startCtxTime = this.ctx.currentTime;
		this.playing = true;

		// Position the scheduler cursor at the first event due at/after the start
		// offset. Long samples that began before the offset but are still sounding
		// (e.g. the BGM track) are started immediately at the correct buffer offset.
		this.nextEventIdx = 0;
		while (
			this.nextEventIdx < this.events.length &&
			this.events[this.nextEventIdx].timeSec < this.startOffset
		) {
			const event = this.events[this.nextEventIdx];
			const buffer = this.buffers.get(event.fileName);
			if (buffer && event.timeSec + buffer.duration > this.startOffset) {
				this.startSource(event, this.ctx.currentTime, this.startOffset - event.timeSec);
			}
			this.nextEventIdx++;
		}

		this.schedulerTimer = setInterval(() => this.tick(), PreviewAudioEngine.TICK_MS);
		this.tick();
	}

	/** Schedule every event whose time falls within the lookahead horizon. */
	private tick(): void {
		if (!this.ctx || !this.playing) return;
		const horizon = this.currentTime + PreviewAudioEngine.SCHEDULE_AHEAD_SEC;
		while (
			this.nextEventIdx < this.events.length &&
			this.events[this.nextEventIdx].timeSec <= horizon
		) {
			const event = this.events[this.nextEventIdx++];
			this.startSource(event, this.startCtxTime + (event.timeSec - this.startOffset), 0);
		}
		// End-of-playback is driven by the audio clock, not a wall-clock timer:
		// `currentTime` is clamped to `duration`, so once the AudioContext clock
		// reaches the end the next tick fires onEnded. A setTimeout would drift
		// under background-tab throttling / main-thread load; the audio clock is
		// what the cursor already reads, so this keeps the transport flip aligned
		// with the last audible sample. handleEnd clears the scheduler, so this
		// fires exactly once per play().
		//
		// Deliberate: sources already scheduled within the SCHEDULE_AHEAD_SEC
		// horizon are NOT stopped here. `duration` is the time of the last note,
		// not the end of its audio tail, so stopping would chop the final hit
		// (e.g. a crash cymbal) the instant it starts. Letting the buffer ring
		// out naturally is the musical behavior for a chart preview.
		if (this.currentTime >= this.duration) {
			this.playing = false;
			this.startOffset = this.duration;
			this.clearScheduler();
			this.onEnded?.();
		}
	}

	private startSource(event: ScheduledEvent, when: number, bufferOffset: number): void {
		if (!this.ctx) return;
		const buffer = this.buffers.get(event.fileName);
		if (!buffer) return;
		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		const gain = this.ctx.createGain();
		gain.gain.value = event.gain * this.masterVolume;
		const panner = this.ctx.createStereoPanner();
		panner.pan.value = event.pan;
		source.connect(panner);
		panner.connect(gain);
		gain.connect(this.ctx.destination);
		const startAt = Math.max(this.ctx.currentTime, when);
		if (bufferOffset > 0) source.start(startAt, bufferOffset);
		else source.start(startAt);
		// Prune finished sources so the active set never accumulates the whole chart.
		source.onended = () => {
			const i = this.active.indexOf(source);
			if (i >= 0) this.active.splice(i, 1);
		};
		this.active.push(source);
	}

	private clearScheduler(): void {
		if (this.schedulerTimer) {
			clearInterval(this.schedulerTimer);
			this.schedulerTimer = null;
		}
	}

	pause(): void {
		if (!this.ctx) return;
		this.startOffset = this.currentTime;
		this.playing = false;
		this.stopSources();
		this.clearScheduler();
	}

	seek(seconds: number): void {
		const clamped = Math.max(0, Math.min(this.duration, seconds));
		if (this.playing) {
			this.play(clamped);
		} else {
			this.startOffset = clamped;
		}
	}

	private stopSources(): void {
		for (const source of this.active) {
			try {
				source.stop();
			} catch {
				/* already stopped */
			}
		}
		this.active = [];
	}

	dispose(): void {
		this.stopSources();
		this.clearScheduler();
		this.buffers.clear();
		this.events = [];
		if (this.ownsContext && this.ctx) void this.ctx.close();
		this.ctx = null;
	}
}
