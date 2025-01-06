import { Input } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { BaseGame, type Note } from './BaseGame';
import { Preview } from './Preview';
import { get } from 'svelte/store';
import store from '@/lib/store';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private isDragging = false;
	protected notes: Record<string, Note[]> = {};
    protected bpmNotes: Record<string, number> = {};
	protected measureLength: number[] = [];

	constructor(protected measureCount: number = 10) {
		super({ key: Editor.key });
	}

	init(data: Data) {
		this.measureCount = data.measureCount || this.measureCount;
	}

	create() {
		console.log("Create Editor Scene")

		this.drawPanel();
		this.drawNotes();

		// Enable drag scrolling
		let startY = 0;
		let startScrollY = 0;

		const clampY = (newY: number) => {
			return Phaser.Math.Clamp(newY, 0, this.laneHeight - this.cameras.main.height + this.bottomMargin + this.cellMargin);
		}

		// Enable input events
		this.input.on('pointerdown', (pointer: Input.Pointer) => {
			if (!this.isEditing) return;
			const x = pointer.x - this.offsetX;
			const y = pointer.worldY - this.offsetY;

			// Calculate the clicked cell
			const laneIndex = Math.floor(x / this.cellWidth);
			const cellIndex = Math.floor(-y / this.cellHeight);

			// Validate the click is within the grid bounds
			if (
				laneIndex >= 0 &&
				laneIndex < this.laneConfigs.length &&
				cellIndex >= 0 &&
				cellIndex < this.measureCount * this.cellsPerMeasure
			) {
				// Draw the note in the clicked cell
				this.drawNote(laneIndex, cellIndex, 0, '00');
				const measure = Math.floor(cellIndex / this.cellsPerMeasure);
				if (!(measure in this.notes)) {
					this.notes[measure] = [];
				}
				this.notes[measure].push({
					measure: measure,
					laneID: this.laneConfigs[laneIndex].id,
					pattern: '00'
				});
			}
		});

		this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			if (this.isEditing) return;
			this.isDragging = true;
			startY = pointer.y;
			startScrollY = this.panelContainer.y;
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (this.isDragging) {
				const deltaY = 3 * (pointer.y - startY);
				let newY = startScrollY + deltaY;
				this.panelContainer.y = clampY(newY);
			}
		});

		this.input.on('pointerup', () => {
			this.isDragging = false;
		});

		this.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: any, deltaX: number, deltaY: number) => {
			if (pointer.y < this.scale.height - this.bottomMargin) {
				let newY = this.panelContainer.y - deltaY * 0.5;
				this.panelContainer.y = clampY(newY);
			}
		});

		this.input.keyboard?.on('keydown-Q', (event: KeyboardEvent) => {
			this.isEditing = !this.isEditing;
		});

		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.MEASURE_UPDATE, (measureCount: number) => {
			this.measureCount = get(store.measureCount);
			this.restart({ measureCount });
		});
		EventBus.on(EventType.NOTE_IMPORT, (notes: Note[], bpmNotes: Record<string, number>) => {
			this.notes = {};
			this.sound.removeAll();
			notes.forEach((note) => {
				if (!(note.laneID in this.notes)) {
					this.notes[note.laneID] = [];
				}
				this.notes[note.laneID].push(note);
			});
			this.parseMesaureLength();
			const maxMeasure = notes.reduce((max, note) => Math.max(max, note.measure), 0);
			if (maxMeasure > this.measureCount) {
				this.measureCount = maxMeasure + 1;
			}
			store.measureCount.set(this.measureCount);
            this.bpmNotes = bpmNotes;
			this.restart({ measureCount: this.measureCount });
		});

		EventBus.on(EventType.MEASURE_GOTO, (measure: number) => {
			this.panelContainer.y = clampY(this.getTotalMesaureOffest(measure));
		});

		EventBus.on(EventType.START_PREVIEW, (bpm: number) => {
			const currentMeasure = Math.floor(this.panelContainer.y / (this.cellHeight * this.cellsPerMeasure));
			this.scene.stop();
			this.scene.start(Preview.key, {
				bpm: bpm,
                bpmNotes: this.bpmNotes,
				notes: this.notes,
				measureCount: this.measureCount,
				startMeasure: currentMeasure
			});
		});

		EventBus.on(EventType.STOP_PREVIEW, () => {
			this.scene.stop(Preview.key);
			this.restart();
		});
	}

	update() {
		// Update logic if needed
	}

	restart(data: Data = {}) {
		console.log("Restart Scene, data", data)
		EventBus.off(EventType.MEASURE_UPDATE);
		EventBus.off(EventType.NOTE_IMPORT);
		EventBus.off(EventType.MEASURE_GOTO);
		EventBus.off(EventType.START_PREVIEW);
		EventBus.off(EventType.STOP_PREVIEW);
		this.input.off('pointerdown');
		this.input.off('pointermove');
		this.input.off('pointerup');
		this.input.off('wheel');
		this.input.keyboard?.off('keydown-Q');
		this.scene.restart(data);
	}
}