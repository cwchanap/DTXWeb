// packages/common/src/lib/audio/previewAudioEngine.ts
import { SoundChip } from '../chart/dtx';
import type { LaneMeasureNote } from '../chart/note';
import type { ChartTiming } from '../notation/timing';
import { XAAudioContext } from '../browser/audioDecoder';

const BPM_CHANNEL = '08';
const MEASURE_LENGTH_CHANNEL = '02';

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
	private endTimer: ReturnType<typeof setTimeout> | null = null;

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
		await Promise.all(
			uniqueNames.map(async (fileName) => {
				try {
					const url = `${params.bucketUrl}/${params.simfileID}/${fileName}`;
					const res = await doFetch(url);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.arrayBuffer();
					const buffer = await this.decode(fileName, data);
					this.buffers.set(fileName, buffer);
				} catch {
					failedFiles.push(fileName);
				}
			})
		);

		return { loaded: this.buffers.size, failedFiles };
	}

	private async decode(fileName: string, data: ArrayBuffer): Promise<AudioBuffer> {
		const ctx = this.ctx!;
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
		this.startCtxTime = this.ctx.currentTime;
		this.playing = true;

		for (const event of this.events) {
			if (event.timeSec < this.startOffset) continue;
			const buffer = this.buffers.get(event.fileName);
			if (!buffer) continue;
			const source = this.ctx.createBufferSource();
			source.buffer = buffer;
			const gain = this.ctx.createGain();
			gain.gain.value = event.gain * this.masterVolume;
			const panner = this.ctx.createStereoPanner();
			panner.pan.value = event.pan;
			source.connect(panner);
			panner.connect(gain);
			gain.connect(this.ctx.destination);
			source.start(this.startCtxTime + (event.timeSec - this.startOffset));
			this.active.push(source);
		}

		if (this.endTimer) clearTimeout(this.endTimer);
		const remaining = Math.max(0, this.duration - this.startOffset);
		this.endTimer = setTimeout(() => {
			this.playing = false;
			this.startOffset = this.duration;
			this.onEnded?.();
		}, remaining * 1000);
	}

	pause(): void {
		if (!this.ctx) return;
		this.startOffset = this.currentTime;
		this.playing = false;
		this.stopSources();
		if (this.endTimer) clearTimeout(this.endTimer);
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
		if (this.endTimer) clearTimeout(this.endTimer);
		this.buffers.clear();
		this.events = [];
		if (this.ownsContext && this.ctx) void this.ctx.close();
		this.ctx = null;
	}
}
