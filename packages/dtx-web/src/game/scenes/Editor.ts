import { Input } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { BaseGame } from './BaseGame';
import { Preview } from './Preview';
import { get } from 'svelte/store';
import store from '$lib/store';
import type { LaneConfig } from '../interface';
import { LaneMeasureNote } from '$lib/chart/note';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private isDragging = false;
	private contextMenuHandler: ((e: Event) => void) | null = null;
	protected notes: Record<string, LaneMeasureNote[]> = {};
	protected bpmNotes: Record<string, number> = {};
	protected measureLength: number[] = [];

	constructor(protected measureCount: number = 10) {
		super({ key: Editor.key });
	}

	init(data: Data) {
		this.measureCount = data.measureCount || this.measureCount;
	}

	create() {
		console.log('Create Editor Scene');

		// Disable browser context menu on the game canvas
		this.disableBrowserContextMenu();

		this.drawPanel();
		this.drawNotes();

		// Enable drag scrolling
		let startY = 0;
		let startScrollY = 0;

		const clampY = (newY: number) => {
			return Phaser.Math.Clamp(
				newY,
				0,
				this.laneHeight - this.cameras.main.height + this.bottomMargin + this.cellMargin
			);
		};

		// Enable input events
		this.input.on('pointerdown', (pointer: Input.Pointer) => {
			if (!this.isEditing) {
				this.isDragging = true;
				startY = pointer.y;
				startScrollY = this.panelContainer.y;
				return;
			}

			const x = pointer.x - this.offsetX;

			// Calculate the absolute Y position by accounting for the container's position (scrolling)
			// The panelContainer.y is positive when scrolled up, so we need to minus it to get the absolute position
			const absoluteY = pointer.y - this.offsetY - this.panelContainer.y;

			// Calculate the clicked cell
			const laneIndex = Math.floor(x / this.cellWidth);
			// We need to negate absoluteY because the grid is drawn from bottom to top
			const cellIndex = Math.floor(-absoluteY / this.cellHeight);

			// Validate the click is within the grid bounds
			if (
				laneIndex >= 0 &&
				laneIndex < this.laneConfigs.length &&
				cellIndex >= 0 &&
				cellIndex < this.measureCount * this.cellsPerMeasure
			) {
				// Calculate the measure from the cell index
				const measure = Math.floor(cellIndex / this.cellsPerMeasure);
				// Calculate the position within the measure
				const cellOffset = (cellIndex % this.cellsPerMeasure) / this.cellsPerMeasure;

				// Check if it's a right-click (pointer.rightButtonDown())
				if (pointer.rightButtonDown()) {
					// Check if there's a note at this position
					const noteKey = `note-${laneIndex}-${measure}-${cellOffset}`;
					const existingNote = this.panelContainer.getByName(noteKey);
					if (existingNote) {
						// Remove the note from the display
						this.panelContainer.getAll('name', noteKey).forEach((note) => {
							note.destroy();
						});
						// Remove the note from this.notes
						const laneId = this.laneConfigs[laneIndex].id;
						if (measure in this.notes) {
							// Find and remove the note with matching measure, laneID, and position
							this.notes[measure] = this.notes[measure].filter(
								(note) =>
									!(
										note.laneID === laneId &&
										note.notes.some(
											(n) => Math.abs(n.position - cellOffset) < 0.001
										)
									)
							);
						}
					}
				} else {
					// Left-click: Add a note (existing behavior)
					// Draw the note in the clicked cell with correct parameters
					// The drawNote method expects (measure, laneIndex, cellOffset, noteId)
					const noteAdded = this.drawNote(measure, laneIndex, cellOffset, '00');
					if (noteAdded) {
						if (!(measure in this.notes)) {
							this.notes[measure] = [];
						}
						this.notes[measure].push(
							new LaneMeasureNote(measure, this.laneConfigs[laneIndex].id, '00')
						);
					}
				}
			}
			console.log(this.notes);
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (this.isDragging) {
				const deltaY = 3 * (pointer.y - startY);
				const newY = startScrollY + deltaY;
				this.panelContainer.y = clampY(newY);
			}
		});

		this.input.on('pointerup', () => {
			this.isDragging = false;
		});

		this.input.on(
			'wheel',
			(
				pointer: Phaser.Input.Pointer,
				_gameObjects: Phaser.GameObjects.GameObject[],
				_deltaX: number,
				deltaY: number
			) => {
				if (pointer.y < this.scale.height - this.bottomMargin) {
					const newY = this.panelContainer.y - deltaY * 0.5;
					this.panelContainer.y = clampY(newY);
				}
			}
		);

		this.input.keyboard?.on('keydown-Q', () => {
			this.isEditing = !this.isEditing;
		});

		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.MEASURE_UPDATE, (measureCount: number) => {
			this.measureCount = get(store.measureCount);
			this.restart({ measureCount });
		});
		EventBus.on(
			EventType.NOTE_IMPORT,
			(notes: LaneMeasureNote[], bpmNotes: Record<string, number>) => {
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
			}
		);

		EventBus.on(EventType.MEASURE_GOTO, (measure: number) => {
			this.panelContainer.y = clampY(this.getTotalMesaureOffest(measure));
		});

		EventBus.on(EventType.START_PREVIEW, (bpm: number) => {
			const currentMeasure = Math.floor(
				this.panelContainer.y / (this.cellHeight * this.cellsPerMeasure)
			);
			this.scene.pause();
			this.scene.setVisible(false);

			if (this.scene.isPaused(Preview.key)) {
				this.scene.setVisible(true, Preview.key);
				this.scene.resume(Preview.key);
				EventBus.emit(EventType.RESUME_PREVIEW, {
					startMeasure: currentMeasure
				});
			} else {
				this.scene.launch(Preview.key, {
					bpm: bpm,
					bpmNotes: this.bpmNotes,
					notes: this.notes,
					measureCount: this.measureCount,
					startMeasure: currentMeasure
				});
			}
		});

		EventBus.on(EventType.STOP_PREVIEW, () => {
			this.scene.pause(Preview.key);
			this.scene.setVisible(false, Preview.key);
			this.scene.resume();
			this.scene.setVisible(true);
		});
	}

	update() {
		// Update logic if needed
	}

	shutdown() {
		// Clean up context menu event listener when scene shuts down
		this.enableBrowserContextMenu();
	}

	restart(data: Data = {}) {
		console.log('Restart Scene, data', data);
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
		// Re-enable browser context menu when restarting
		this.enableBrowserContextMenu();
		this.scene.restart(data);
	}

	drawFooterLane(laneConfig: LaneConfig, currentX: number) {
		const text = this.add
			.text(currentX + this.cellWidth / 2, this.offsetY + 20, laneConfig.name, {
				fontSize: '16px',
				color: '#ffffff'
			})
			.setOrigin(0.5);
		this.footerContainer.add(text);
	}

	private disableBrowserContextMenu() {
		// Get the game canvas element
		const gameContainer = document.getElementById('game-container');
		if (gameContainer) {
			// Create the context menu handler
			this.contextMenuHandler = (e: Event) => {
				e.preventDefault();
				return false;
			};

			// Add event listener to prevent context menu
			gameContainer.addEventListener('contextmenu', this.contextMenuHandler);
		}
	}

	private enableBrowserContextMenu() {
		// Get the game canvas element
		const gameContainer = document.getElementById('game-container');
		if (gameContainer && this.contextMenuHandler) {
			// Remove the event listener
			gameContainer.removeEventListener('contextmenu', this.contextMenuHandler);
			this.contextMenuHandler = null;
		}
	}
}
