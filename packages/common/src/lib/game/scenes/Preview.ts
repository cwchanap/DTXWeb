import Phaser from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '../../store';
import { getFileProvider } from '../../services/fileProvider';
import type { LaneMeasureNote } from '../../chart/note';
import type { SoundChip } from '../../chart/dtx';
import { BaseGame } from './BaseGame';
import { AssetName, type LaneConfig } from '../interface';
import { getAssetPath } from '../utils';
import { calculateHighResolutionPosition } from '../utils/notePositioning';
import { PreviewCalculations } from './previewCalculations';
import { getSoundCacheKey, prepareSoundChipAudioSource } from '../audio/soundChipPreparation';

interface Data {
	measureCount: number;
	notes: Record<string, LaneMeasureNote[]>;
	bpm: number;
	bpmNotes: Record<string, number>;
	startMeasure: number;
}

export class Preview extends BaseGame {
	static key = 'Preview';
	static bgmNoteID = '01';
	static bpmNoteID = '08';
	private playSpeed = 1;
	private bpm = 0;
	private startMeasure = 0;
	protected measureCount = 0;
	protected cellHeight = 50;

	private playingAudio: Phaser.Sound.WebAudioSound[] = [];
	private previewTween: Phaser.Tweens.Tween | null = null;
	protected measureLength: number[] = [];
	protected notes: Record<string, LaneMeasureNote[]> = {};
	protected bpmNotes: Record<string, number> = {};

	// Additional containers for separating elements with different scaling
	protected gridContainer!: Phaser.GameObjects.Container; // For grid lines that will scale
	protected notesContainer!: Phaser.GameObjects.Container; // For notes that won't scale
	private storeUnsubscribe: (() => void) | null = null;

	// Track if scene is fully initialized
	private isInitialized = false;

	// Bound event handlers to prevent listener leaks
	private readonly boundStopPreview = () => this.pausePreview();
	private readonly boundResumePreview = (data: { startMeasure: number }) => {
		this.startMeasure = data.startMeasure;
		this.resumePreview();
	};

	// Global animation cache to avoid recreating animations every time
	private static animationsCreated = false;
	private static soundCacheMap = new Map<string, { blob: Blob; processed: boolean }>();
	private static loadedFiles = new Map<string, File>();

	private inflightLoads = new Map<
		string,
		{ file: File; promise: Promise<void>; cancel: () => void }
	>();

	private lifecycleGeneration = 0;

	private setupSoundsSeq = 0;

	private previewSoundSetup: Promise<void> | null = null;
	private pendingPreviewStart: 'with-sounds' | 'without-sounds' | null = null;

	// Phaser-free timing/measure-offset calculations, kept in sync with this
	// scene's chart data at the same points it was previously updated directly
	// (init() and updateData()).
	private calculations: PreviewCalculations = new PreviewCalculations({
		bpm: this.bpm,
		notes: this.notes,
		bpmNotes: this.bpmNotes,
		measureCount: this.measureCount,
		measureLength: this.measureLength,
		cellHeight: this.cellHeight,
		cellsPerMeasure: this.cellsPerMeasure
	});

	constructor() {
		super({ key: Preview.key });
		this.laneConfigs = this.laneConfigs.filter((lane) => lane.playable);
		// SHUTDOWN/DESTROY listeners are registered by BaseGame.init(), which
		// runs before create() on every scene start/restart. shutdown() cleans
		// up the Svelte store subscription (storeUnsubscribe), preview tween,
		// playing audio, scheduled time events, and EventBus handlers, and is
		// idempotent so both listeners firing is safe.
	}

	init(data: Data) {
		super.init(data);
		this.measureCount = data.measureCount;
		this.notes = data.notes;
		this.bpm = data.bpm;
		this.bpmNotes = data.bpmNotes;
		this.startMeasure = data.startMeasure;

		this.calculations.update({
			bpm: this.bpm,
			notes: this.notes,
			bpmNotes: this.bpmNotes,
			measureCount: this.measureCount,
			measureLength: this.measureLength
		});

		store.playSpeed.subscribe((value) => {
			const seekTime =
				this.previewTween && Number.isFinite(this.previewTween.elapsed)
					? this.previewTween.elapsed
					: null;

			this.playSpeed = value;

			// Update camera zoom based on play speed
			if (this.cameras && this.cameras.main) {
				this.updateCameraZoom();
			}

			// Update tween if it exists
			if (this.previewTween) {
				// Recreate the tween with the new scale and seek to the correct time offset
				this.createPreviewTween();

				if (this.previewTween && seekTime !== null) {
					this.previewTween.seek(seekTime);
				}
			}
		});
	}

	preload() {
		this.load.spritesheet(AssetName.LANE_ICONS, getAssetPath(AssetName.LANE_ICONS), {
			frameWidth: 96,
			frameHeight: 96
		});

		// Load the drum chips spritesheet as a regular image
		this.load.image(AssetName.DRUM_CHIPS, getAssetPath(AssetName.DRUM_CHIPS));
	}

	async create() {
		// Create animations only once globally
		if (!Preview.animationsCreated) {
			this.createNoteAnimations();
			Preview.animationsCreated = true;
		}

		// Initialize containers that will be used in drawPanel
		this.gridContainer = this.add.container(0, 0);
		this.notesContainer = this.add.container(0, 0);

		// Draw panel and notes
		this.drawPanel();
		this.drawNotes();

		// Start preview only once after everything is set up
		this.startPreview();

		// Subscribe to currentSoundChip changes so sounds reload when the chip
		// changes after scene creation. Svelte stores invoke the subscriber
		// immediately with the current value on subscribe; skip that initial
		// replay so we don't redundantly reload sounds we just set up above.
		let skipInitialSoundChipReplay = true;
		this.storeUnsubscribe = store.currentSoundChip.subscribe(async (soundChips) => {
			if (skipInitialSoundChipReplay) {
				skipInitialSoundChipReplay = false;
				return;
			}
			if (
				!soundChips?.some((chip) => chip.fileName) &&
				this.pendingPreviewStart === 'with-sounds'
			) {
				this.pendingPreviewStart = null;
			}
			await this.setupSoundsForPreview();
		});

		this.isInitialized = true;
		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.STOP_PREVIEW, this.boundStopPreview);
		EventBus.on(EventType.RESUME_PREVIEW, this.boundResumePreview);
	}

	private removeEventBusListeners(): void {
		EventBus.off(EventType.STOP_PREVIEW, this.boundStopPreview);
		EventBus.off(EventType.RESUME_PREVIEW, this.boundResumePreview);
	}

	/**
	 * Pause the preview (stop audio and tweens but keep scene alive)
	 */
	private pausePreview(): void {
		this.pendingPreviewStart = null;

		// Stop preview tween
		if (this.previewTween) {
			this.previewTween.pause();
		}

		// Stop all playing audio
		this.playingAudio.forEach((audio) => {
			audio.stop();
		});
		this.playingAudio = [];

		// Clear all scheduled audio events since resume may be from different position
		this.time.removeAllEvents();
	}

	/**
	 * Resume the preview from current position
	 */
	private resumePreview(): void {
		// Always restart preview since startMeasure may have changed
		// Skip sound loading if already done
		if (this.previewSoundSetup) {
			this.pendingPreviewStart = get(store.currentSoundChip)?.some((chip) => chip.fileName)
				? 'with-sounds'
				: 'without-sounds';
			return;
		}
		this.startPreviewWithoutSoundReload();
	}

	/**
	 * Update scene data without recreating the scene
	 */
	public updateData(data: {
		bpm: number;
		bpmNotes: Record<string, number>;
		notes: Record<string, LaneMeasureNote[]>;
		measureCount: number;
		startMeasure: number;
	}): void {
		// Update internal data
		this.bpm = data.bpm;
		this.bpmNotes = data.bpmNotes;
		this.notes = data.notes;
		this.measureCount = data.measureCount;
		this.startMeasure = data.startMeasure;

		// Sync the calculations helper with the new data (also invalidates its caches)
		this.calculations.update({
			bpm: this.bpm,
			notes: this.notes,
			bpmNotes: this.bpmNotes,
			measureCount: this.measureCount,
			measureLength: this.measureLength
		});

		// Parse measure lengths with new data
		this.parseMesaureLength();

		// Clear existing visual elements without destroying containers
		this.gridContainer.removeAll(true);
		this.notesContainer.removeAll(true);

		// Clear panel container contents but don't destroy it
		if (this.panelContainer) {
			this.panelContainer.removeAll();
		}

		// Redraw with new data
		this.drawGridLines();
		this.drawNotes();

		// Ensure containers are properly added back to panel
		if (this.panelContainer) {
			this.panelContainer.add(this.gridContainer);
			this.panelContainer.add(this.notesContainer);
		}

		// Restart preview with new data
		this.startPreview();
	}

	private async setupSoundsAsync(): Promise<void> {
		const generation = this.lifecycleGeneration;
		const setupSeq = ++this.setupSoundsSeq;
		const soundChips = get(store.currentSoundChip);
		const currentSimfileID = get(store.currentSimfileID);

		// Filter out sound chips that are already loaded to avoid redundant file operations
		const uniqueSoundChips = new Map<string, SoundChip>();
		for (const soundChip of soundChips ?? []) {
			if (!soundChip.fileName) continue;
			const cacheKey = this.getCacheKey(soundChip);
			if (!uniqueSoundChips.has(cacheKey)) {
				uniqueSoundChips.set(cacheKey, soundChip);
			}
		}

		for (const [cacheKey, inflight] of this.inflightLoads) {
			if (!uniqueSoundChips.has(cacheKey)) {
				inflight.cancel();
			}
		}

		// If no sounds need loading, return early
		if (uniqueSoundChips.size === 0) {
			return;
		}

		const fileProvider = getFileProvider();

		// Create promises for unloaded sound chips only
		const loadPromises = [...uniqueSoundChips].map(async ([cacheKey, soundChip]) => {
			try {
				// Get file from FileProvider for both local and remote files
				const actualFile = await fileProvider.getFile(currentSimfileID, soundChip.fileName);
				if (generation !== this.lifecycleGeneration || setupSeq !== this.setupSoundsSeq) {
					return;
				}
				const previousFile = Preview.loadedFiles.get(cacheKey);
				const inflight = this.inflightLoads.get(cacheKey);

				if (!actualFile) {
					this.evictSoundChip(cacheKey);
					return;
				}

				if (inflight && inflight.file === actualFile) {
					return await inflight.promise;
				}

				// Check if already in Phaser cache and sound manager
				const alreadyLoaded =
					previousFile === actualFile &&
					this.cache &&
					this.cache.audio &&
					this.cache.audio.exists(cacheKey) &&
					this.sound.get(cacheKey);

				if (alreadyLoaded) {
					inflight?.cancel();
					return;
				}

				if (previousFile !== actualFile) {
					this.evictSoundChip(cacheKey);
				} else {
					inflight?.cancel();
				}

				const staleSound = this.sound && this.sound.get(cacheKey);
				if (staleSound) {
					staleSound.stop();
					this.sound.remove(staleSound);
					this.playingAudio = this.playingAudio.filter((audio) => audio !== staleSound);
				}

				// Remove existing cache entry if it exists
				if (this.cache && this.cache.audio) {
					this.cache.audio.remove(cacheKey);
				}

				// Check global sound cache for processed files
				const globalCacheEntry = Preview.soundCacheMap.get(cacheKey);
				if (globalCacheEntry && globalCacheEntry.processed) {
					// Use cached processed audio
					const result = await this.loadSoundChipAsync(
						actualFile,
						soundChip,
						cacheKey,
						globalCacheEntry.blob
					);
					return result;
				}

				// Create a promise that resolves when this audio is loaded
				const result = await this.loadSoundChipAsync(actualFile, soundChip, cacheKey);
				return result;
			} catch (error) {
				console.warn(`🔊 Failed to setup sound chip ${soundChip.fileName}:`, error);
			}
		});

		// Wait for all audio files to be loaded, filtering out undefined values
		await Promise.all(loadPromises.filter(Boolean));
	}

	private evictSoundChip(cacheKey: string): void {
		this.inflightLoads.get(cacheKey)?.cancel();
		const staleSound = this.sound && this.sound.get(cacheKey);
		if (staleSound) {
			staleSound.stop();
			this.sound.remove(staleSound);
			this.playingAudio = this.playingAudio.filter((audio) => audio !== staleSound);
		}
		if (this.cache && this.cache.audio) {
			this.cache.audio.remove(cacheKey);
		}
		Preview.soundCacheMap.delete(cacheKey);
		Preview.loadedFiles.delete(cacheKey);
	}

	private discardPendingAudioFile(cacheKey: string, retainedFile?: Phaser.Loader.File): void {
		const discarded = new Set<Phaser.Loader.File>();
		const discard = (file: Phaser.Loader.File | undefined) => {
			if (!file || file.type !== 'audio' || file.key !== cacheKey || discarded.has(file)) {
				return;
			}
			discarded.add(file);
			if (file.xhrLoader && typeof file.xhrLoader.abort === 'function') {
				file.xhrLoader.abort();
			}
			file.resetXHR();
			(file as { cache: unknown }).cache = null;
		};
		discard(retainedFile);
		const loader = this.load;
		if (!loader) {
			return;
		}
		for (const set of [loader.list, loader.inflight, loader.queue]) {
			if (!set || typeof set.each !== 'function') {
				continue;
			}
			const pending: Phaser.Loader.File[] = [];
			set.each((file: Phaser.Loader.File) => {
				if (file && file.type === 'audio' && file.key === cacheKey) {
					pending.push(file);
				}
				return true;
			});
			for (const file of pending) {
				discard(file);
				set.delete(file);
			}
		}
	}

	private async loadSoundChipAsync(
		actualFile: File,
		soundChip: SoundChip,
		cacheKey: string,
		cachedBlob?: Blob
	): Promise<void> {
		// Check if scene is properly initialized
		if (!this.load || !this.sound) {
			console.warn(`Scene not properly initialized for loading ${soundChip.fileName}`);
			return;
		}

		// Create a Promise to handle the loading
		let resolvePromise!: () => void;
		const loadPromise = new Promise<void>((resolve) => {
			resolvePromise = resolve;
		});

		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let onFileComplete: (() => void) | undefined;
		let onLoadError: ((file: { key?: string }) => void) | undefined;
		let loaderFile: Phaser.Loader.File | undefined;
		let entry: { file: File; promise: Promise<void>; cancel: () => void } | undefined;

		const teardown = () => {
			// Clear timeout on successful load
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
			}
			if (onFileComplete) {
				this.load.off(`filecomplete-audio-${cacheKey}`, onFileComplete);
			}
			if (onLoadError) {
				this.load.off('loaderror', onLoadError);
			}
			this.discardPendingAudioFile(cacheKey, loaderFile);
			if (this.inflightLoads.get(cacheKey) === entry) {
				this.inflightLoads.delete(cacheKey);
			}
		};

		const finish = (usable: boolean) => {
			if (settled) return;
			settled = true;
			teardown();
			if (usable) {
				// Add to sound manager once loaded
				if (!this.sound.get(cacheKey)) {
					this.sound.add(cacheKey);
				}
				Preview.loadedFiles.set(cacheKey, actualFile);
			}
			resolvePromise();
		};

		entry = {
			file: actualFile,
			promise: loadPromise,
			cancel: () => {
				if (settled) return;
				settled = true;
				teardown();
				resolvePromise();
			}
		};
		this.inflightLoads.set(cacheKey, entry);

		const setupListenersAndLoad = async () => {
			try {
				const { objectUrl, wavBlob } = await prepareSoundChipAudioSource(
					actualFile,
					soundChip,
					cachedBlob
				);

				if (settled) {
					URL.revokeObjectURL(objectUrl);
					return;
				}

				// A freshly-decoded XA file produces a wavBlob; cache it for reuse
				if (wavBlob) {
					Preview.soundCacheMap.set(cacheKey, { blob: wavBlob, processed: true });
				}

				// Add listeners and load
				// Add a completion listener for this specific audio BEFORE loading
				onFileComplete = () => {
					if (!this.cache || !this.cache.audio || !this.cache.audio.exists(cacheKey)) {
						return;
					}
					finish(true);
				};
				this.load.on(`filecomplete-audio-${cacheKey}`, onFileComplete);

				// Add error listener to catch load failures
				onLoadError = (file: { key?: string }) => {
					if (!file || file.key !== cacheKey) {
						return;
					}
					console.warn(`Failed to load audio file: ${cacheKey}`, file);
					finish(false); // Still resolve to prevent hanging
				};
				this.load.on('loaderror', onLoadError);

				// Add a timeout fallback in case neither event fires
				timeoutId = setTimeout(() => {
					console.warn(`Timeout loading audio file: ${cacheKey}`);
					finish(false);
				}, 10000); // 10 second timeout

				const onAddFile = (
					key: string,
					type: string,
					_loader: unknown,
					file: Phaser.Loader.File
				) => {
					if (type === 'audio' && key === cacheKey) {
						loaderFile = file;
					}
				};
				this.load.on('addfile', onAddFile);
				try {
					this.load.audio(cacheKey, objectUrl);
				} finally {
					this.load.off('addfile', onAddFile);
				}
				this.load.start();
			} catch (error) {
				console.warn(`Failed to decode XA file ${soundChip.fileName}:`, error);
				finish(false);
			}
		};

		setupListenersAndLoad();
		return loadPromise;
	}

	override drawPanel() {
		// Call super.drawFooter() to set up the footer container
		this.drawFooter();

		// Create panel container
		this.panelContainer = this.add.container(0, 0);
		this.panelContainer.setSize(this.scale.width, this.laneHeight);

		// Set up the container hierarchy
		this.panelContainer.add(this.gridContainer);
		this.panelContainer.add(this.notesContainer);

		// Parse measure lengths
		this.parseMesaureLength();

		// Draw grid lines into the gridContainer
		this.drawGridLines();

		// Set camera bounds and add mask for scrolling
		this.setCameraBounds();

		const mask = this.make.graphics();
		mask.fillStyle(0xffffff);
		mask.fillRect(0, 0, this.scale.width, this.scale.height - this.bottomMargin);
		this.panelContainer.setMask(mask.createGeometryMask());
	}

	// Helper method to draw grid lines into gridContainer
	drawGridLines() {
		// Create separate graphics objects for vertical and horizontal lines
		// This ensures proper rendering with different line styles
		const verticalLines = this.add.graphics();
		const horizontalLines = this.add.graphics();
		const measureLines = this.add.graphics();

		// Set line styles
		verticalLines.lineStyle(1, 0x888888, 1); // Light grey for cells
		horizontalLines.lineStyle(1, 0x888888, 1); // Light grey for cells
		measureLines.lineStyle(2, 0xffffff, 1); // White for measure lines

		// Draw vertical lanes
		let currentX = this.offsetX;
		this.laneConfigs.forEach(() => {
			verticalLines.moveTo(currentX, this.offsetY);
			verticalLines.lineTo(currentX, this.offsetY - this.laneHeight);
			currentX += this.cellWidth;
		});

		// Draw the last vertical line
		verticalLines.moveTo(currentX, this.offsetY);
		verticalLines.lineTo(currentX, this.offsetY - this.laneHeight);

		// Draw horizontal lines for measures
		let y = this.offsetY;
		for (let j = 0; j < this.measureCount; j++) {
			const measureHeight = this.getMeasureHeight(j);

			// Draw the measure line
			measureLines.moveTo(this.offsetX, y);
			measureLines.lineTo(this.offsetX + this.totalWidth, y);

			// Draw cell lines within each measure (subdivisions)
			const cellsPerMeasure = this.cellsPerMeasure;
			const cellHeight = measureHeight / cellsPerMeasure;

			for (let i = 1; i < cellsPerMeasure; i++) {
				const cellY = y - i * cellHeight;
				horizontalLines.moveTo(this.offsetX, cellY);
				horizontalLines.lineTo(this.offsetX + this.totalWidth, cellY);
			}

			// Update y for the next measure
			y -= measureHeight;
		}

		// Stroke all paths and add to gridContainer
		verticalLines.strokePath();
		horizontalLines.strokePath();
		measureLines.strokePath();

		this.gridContainer.add(verticalLines);
		this.gridContainer.add(horizontalLines);
		this.gridContainer.add(measureLines);
	}

	startPreview() {
		// Load sounds first if needed
		this.pendingPreviewStart = get(store.currentSoundChip)?.some((chip) => chip.fileName)
			? 'with-sounds'
			: 'without-sounds';
		this.setupSoundsForPreview();
	}

	private setupSoundsForPreview(): Promise<void> {
		const generation = this.lifecycleGeneration;
		const setup = this.setupSoundsAsync();
		this.previewSoundSetup = setup;
		return setup.then(() => {
			if (generation !== this.lifecycleGeneration || this.previewSoundSetup !== setup) {
				return;
			}
			this.previewSoundSetup = null;
			if (this.pendingPreviewStart === null) {
				return;
			}
			this.pendingPreviewStart = null;
			// Then start preview
			this.startPreviewWithoutSoundReload();
		});
	}

	/**
	 * Start preview without reloading sounds (for resume operations)
	 */
	private startPreviewWithoutSoundReload() {
		// Stop any existing preview to avoid double scheduling
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween.destroy();
			this.previewTween = null;
		}

		// Stop any playing audio to avoid overlaps
		this.playingAudio.forEach((audio) => {
			audio.stop();
		});
		this.playingAudio = [];

		// Clear any pending audio events (this is OK here since we're restarting)
		this.time.removeAllEvents();

		// Update camera zoom based on current play speed
		this.updateCameraZoom();

		// Create a new preview tween starting from the beginning (0 progress)
		this.createPreviewTween();

		// Cache seconds per measure calculation
		const secondsPerMeasure = (60 * 4) / this.bpm;

		// Only schedule BGM playback if not disabled
		const disableBgmPreview = get(store.disableBgmPreview);
		if (!disableBgmPreview && this.notes[Preview.bgmNoteID]) {
			this.notes[Preview.bgmNoteID].forEach((note) => {
				this.scheduleBGMPlayback(note, secondsPerMeasure, this.startMeasure);
			});
		}

		// Pre-filter playable lanes and notes to reduce iterations
		const playableLanes = this.laneConfigs.filter((lane) => lane.playable);
		const relevantNotes = playableLanes
			.map(
				(lane) =>
					this.notes[lane.id]?.filter((note) => note.measure >= this.startMeasure) || []
			)
			.flat();

		// Schedule note playback for all relevant notes at once
		relevantNotes.forEach((note) => {
			this.scheduleNotePlayback(note, secondsPerMeasure, this.startMeasure);
		});
	}

	getTimeElapsed(measure: number, noteChipPosition: number = 0) {
		return this.calculations.getTimeElapsed(measure, noteChipPosition);
	}

	// Override getTotalMesaureOffest with caching for performance
	override getTotalMesaureOffest(measure: number): number {
		return this.calculations.getCachedMeasureOffset(measure, () =>
			super.getTotalMesaureOffest(measure)
		);
	}

	getCacheKey(soundChip: SoundChip) {
		return getSoundCacheKey(soundChip);
	}

	override setCameraBounds() {
		this.cameras.main.setBounds(
			0,
			-this.laneHeight - this.bottomMargin,
			this.scale.width,
			this.laneHeight + this.bottomMargin + this.cameras.main.height
		);

		// Initialize camera zoom
		this.updateCameraZoom();
	}

	scheduleBGMPlayback(note: LaneMeasureNote, secondsPerMeasure: number, startMeasure: number) {
		// Set the measureLength for the note if it's not already set
		if (note.measureLength === 1) {
			note.measureLength = this.measureLength[note.measure] || 1;
		}

		note.notes.forEach((noteChip: { noteID: string; position: number }) => {
			// Calculate the absolute time of this note from the beginning
			const noteAbsoluteTime = this.getTimeElapsed(note.measure, noteChip.position);

			// Calculate the absolute time of the start measure
			const startTime = this.getTimeElapsed(startMeasure);

			// The delay is the difference between when the note should play and when we start
			const delay = noteAbsoluteTime - startTime;

			// Calculate seek if we're starting after this note should have played
			const seek = delay < 0 ? -delay : 0;

			// BGM notes need to play even if they're before the start point (with seek)
			this.time.delayedCall(Math.max(0, delay) * 1000, () => {
				const soundChip = (get(store.currentSoundChip) ?? []).find(
					(chip) => chip.id === parseInt(noteChip.noteID, 36)
				);

				if (soundChip) {
					const cacheKey = this.getCacheKey(soundChip);
					const audio = this.sound.get(cacheKey);

					if (audio) {
						this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
						audio.play({
							seek: seek,
							volume: soundChip.volume / 100
						});
					}
				}
			});
		});
	}

	/**
	 * Creates a tween animation for preview scrolling
	 * @param startY - The starting Y position of the panel
	 */
	createPreviewTween(startY: number | undefined = undefined) {
		// Calculate target distances
		const zoomOffset = this.getZoomOffset(this.playSpeed);
		const targetY = this.getTotalMesaureOffest(this.startMeasure) * this.playSpeed;
		const totalDistance =
			this.getTotalMesaureOffest(this.measureCount) * this.playSpeed - zoomOffset;
		const startPosition = startY ?? targetY - zoomOffset;

		// Calculate total duration based on BPM
		const totalDuration =
			(this.getTimeElapsed(this.measureCount) - this.getTimeElapsed(this.startMeasure)) *
			1000;

		// Clean up existing tween if any
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween.destroy();
			this.previewTween = null;
		}

		// Set the panel position if different from current
		this.panelContainer.setPosition(0, startPosition);

		// Create a new tween
		this.previewTween = this.tweens.add({
			targets: this.panelContainer,
			y: { from: startPosition, to: totalDistance },
			duration: totalDuration,
			ease: 'Linear',
			repeat: -1,
			repeatDelay: 0,
			holdDelayedCalls: false,
			yoyo: false
		});

		return this.previewTween;
	}

	scheduleNotePlayback(note: LaneMeasureNote, secondsPerMeasure: number, startMeasure: number) {
		// Set the measureLength for the note if it's not already set
		if (note.measureLength === 1) {
			note.measureLength = this.measureLength[note.measure] || 1;
		}

		note.notes.forEach((noteChip: { noteID: string; position: number }) => {
			// Calculate the absolute time of this note from the beginning
			const noteAbsoluteTime = this.getTimeElapsed(note.measure, noteChip.position);

			// Calculate the absolute time of the start measure
			const startTime = this.getTimeElapsed(startMeasure);

			// The delay is the difference between when the note should play and when we start
			const delay = noteAbsoluteTime - startTime;

			// Only schedule notes that will play after the start time
			if (delay >= 0) {
				this.time.delayedCall(delay * 1000, () => {
					const soundChip = (get(store.currentSoundChip) ?? []).find(
						(chip) => chip.id === parseInt(noteChip.noteID, 36)
					);
					if (soundChip) {
						const cacheKey = this.getCacheKey(soundChip);
						const audio = this.sound.get(cacheKey);
						if (audio) {
							this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
							audio.play({
								volume: soundChip.volume / 100
							});
						}
					}
				});
			}
		});
	}

	getCellHeight(measure: number, cell: number): number {
		return this.calculations.getCellHeight(measure, cell);
	}

	drawFooterLane(laneConfig: LaneConfig, currentX: number) {
		const iconFrameIndex = laneConfig.iconFrameIndex;

		if (iconFrameIndex !== undefined) {
			const icon = this.add.sprite(
				currentX + this.cellWidth / 2,
				this.offsetY + 30,
				AssetName.LANE_ICONS,
				laneConfig.iconFrameIndex
			);

			// Scale the icon to fit the lane width
			const scale = Math.min(this.cellWidth / icon.width, 0.45); // 0.45 is to make it a bit smaller than the lane
			icon.setScale(scale);

			// Center the icon in the lane
			icon.setOrigin(0.5);

			// Add to the footer container
			this.footerContainer.add(icon);
		}
	}

	createNoteAnimations() {
		// Clear any existing animations to prevent "key already exists" warnings
		this.laneConfigs.forEach((laneConfig) => {
			if (!laneConfig.playable) return;
			const laneId = laneConfig.id;
			const baseKey = `note-${laneId}-base`;
			const overlayKey = `note-${laneId}-overlay`;

			// Remove existing animations if they exist
			if (this.anims.exists(baseKey)) {
				this.anims.remove(baseKey);
			}
			if (this.anims.exists(overlayKey)) {
				this.anims.remove(overlayKey);
			}
		});

		// Create custom frames for the spritesheet since each note has different width
		const texture = this.textures.get(AssetName.DRUM_CHIPS);
		const frameHeight = 64; // Height of each note graphic
		const totalRows = 11; // Number of rows in the spritesheet (0-10)

		// For this spritesheet, we need to handle it differently
		// The spritesheet has 12 columns (one for each note type)
		// Each column has 11 frames (0-10)
		// The columns are arranged in order of the note types
		// We need to map each note type to its column index

		// Define the order of note types in the spritesheet (from left to right)
		const noteOrder = [
			'13', // Right BassDrum
			'19', // RideCymbal
			'12', // Snare
			'14', // HighTom
			'15', // LowTom
			'17', // FloorTom
			'16', // Right Cymbal
			'11', // HiHatClose
			'1C', // LeftBassDrum
			'1A', // LeftCymbal
			'18', // HiHatOpen
			'1B' // LeftPedal
		];

		// Calculate the x position for each note type in the spritesheet
		const columnPositions: Record<string, number> = {};
		let currentX = 0;

		// Calculate the x position for each note type based on its order in the spritesheet
		noteOrder.forEach((noteId) => {
			const laneConfig = this.laneConfigs.find((lc) => lc.id === noteId);
			if (laneConfig && laneConfig.width) {
				columnPositions[noteId] = currentX;
				currentX += laneConfig.width;
			}
		});

		// Create animations for each note type with playable lanes
		this.laneConfigs.forEach((laneConfig) => {
			if (!laneConfig.playable || !laneConfig.width) return;

			const laneId = laneConfig.id;
			const frameWidth = laneConfig.width;
			const xPosition = columnPositions[laneId];

			// Create frames for this note type
			for (let row = 0; row < totalRows; row++) {
				texture.add(
					`${laneId}_${row}`, // Frame name: e.g., "11_0" for HiHatClose frame 0
					0, // Source image index
					xPosition, // x position in the spritesheet based on column
					row * frameHeight, // y position based on row
					frameWidth, // Width of this note type
					frameHeight // Height is fixed
				);
			}

			// Create base animation (animation 1) - frames 2-9
			this.anims.create({
				key: `note-${laneId}-base`,
				frames: [
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_2` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_3` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_4` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_5` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_6` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_7` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_8` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_9` }
				],
				frameRate: 12,
				repeat: -1
			});

			// Create overlay animation (animation 2) - frames 0, 1, 10
			this.anims.create({
				key: `note-${laneId}-overlay`,
				frames: [
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_0` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_1` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_10` }
				],
				frameRate: 8,
				repeat: -1
			});
		});
	}

	updateCameraZoom() {
		// Apply scale to grid container only
		if (this.gridContainer) {
			this.gridContainer.setScale(1, this.playSpeed);
		}

		// Ensure notes container maintains normal scale
		if (this.notesContainer) {
			this.notesContainer.setScale(1, this.playSpeed);
			this.notesContainer
				.getAll()
				.forEach((obj) =>
					(obj as Phaser.GameObjects.Graphics).setScale(1, 1 / this.playSpeed)
				);
		}
	}

	private getZoomOffset(scale: number): number {
		return this.offsetY * (scale - 1);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	override drawNote(measure: number, laneIndex: number, cellOffset: number, noteId: string) {
		const laneConfig = this.laneConfigs[laneIndex];
		const laneId = laneConfig.id;

		// In Preview mode, only show animated notes for playable lanes with defined width
		if (!laneConfig.playable || !laneConfig.width) {
			// Skip drawing non-playable or non-animated notes
			return false;
		}

		const x = this.offsetX + this.cellWidth * laneIndex + this.cellWidth / 2;

		// Calculate Y position based on measure offset and cell position
		const yOffset = this.getTotalMesaureOffest(measure);

		// Calculate the position within the measure using high-resolution grid
		// This allows for proper positioning of 24th, 32nd, 48th, and 64th notes
		const { wholeCells, fractionalCell } = calculateHighResolutionPosition(
			cellOffset,
			this.cellsPerMeasure
		);

		// Add offsets for each cell up to the note position
		let cellsYOffset = 0;

		for (let i = 0; i < wholeCells; i++) {
			cellsYOffset += this.getCellHeight(measure, i % this.cellsPerMeasure);
		}

		// Add fractional cell offset
		if (fractionalCell > 0) {
			cellsYOffset +=
				fractionalCell * this.getCellHeight(measure, wholeCells % this.cellsPerMeasure);
		}

		const y = this.offsetY - (yOffset + cellsYOffset);

		const noteKey = `note-${laneIndex}-${measure}-${cellOffset}`;
		const existingNote = this.children.getByName(noteKey);

		if (existingNote) {
			// If the note already exists, remove it
			this.children.getAll('name', noteKey).forEach((note) => {
				note.destroy();
			});
			return false;
		} else {
			// Create a container for the note sprites
			const container = this.add.container(x, y);
			container.setName(noteKey);

			// Calculate scale based on the cell width and note width
			const scale = Math.min((this.cellWidth - this.cellMargin * 2) / laneConfig.width, 1);

			// Create base animation sprite
			const baseSprite = this.add.sprite(0, 0, AssetName.DRUM_CHIPS);
			baseSprite.setOrigin(0.5, 0.5);
			baseSprite.setScale(scale);
			baseSprite.play(`note-${laneId}-base`);
			container.add(baseSprite);

			// Create overlay animation sprite
			const overlaySprite = this.add.sprite(0, 0, AssetName.DRUM_CHIPS);
			overlaySprite.setOrigin(0.5, 0.5);
			overlaySprite.setScale(scale);
			overlaySprite.play(`note-${laneId}-overlay`);
			container.add(overlaySprite);

			// Add the container to the notes container instead of panel container
			this.notesContainer.add(container);
			return true;
		}
	}

	shutdown() {
		this.lifecycleGeneration++;
		this.previewSoundSetup = null;
		this.pendingPreviewStart = null;
		for (const inflightLoad of [...this.inflightLoads.values()]) {
			inflightLoad.cancel();
		}

		// This is called when the scene is actually stopped/destroyed
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween.destroy();
			this.previewTween = null;
		}

		this.playingAudio.forEach((audio) => {
			audio.stop();
		});
		this.playingAudio = [];

		// Clear all delayed calls to prevent hanging
		this.time.removeAllEvents();

		// Clean up store subscription
		if (this.storeUnsubscribe) {
			this.storeUnsubscribe();
			this.storeUnsubscribe = null;
		}

		// Remove event listeners to prevent leaks
		this.removeEventBusListeners();

		// Reset all container scales
		if (this.gridContainer) this.gridContainer.setScale(1);
		if (this.notesContainer) this.notesContainer.setScale(1);

		// Reset camera zoom
		if (this.cameras && this.cameras.main) {
			this.cameras.main.setZoom(1);
		}

		// Reset initialization state
		this.isInitialized = false;
	}

	cleanUp() {
		// This is called when preview is paused (soft stop)
		this.pausePreview();
	}
}
