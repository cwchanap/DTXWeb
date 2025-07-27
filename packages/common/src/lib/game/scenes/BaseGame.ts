import { LaneMeasureNote } from '../../chart/note.js';
import { normalizePosition } from '../../utils/position.js';
import Phaser from 'phaser';
import { type LaneConfig } from '../interface.js';
import { calculateHighResolutionPosition } from '../utils/notePositioning.js';

export abstract class BaseGame extends Phaser.Scene {
	static measureLengthNoteID = '02';
	protected cellsPerMeasure = 16;
	protected cellWidth = 50;
	protected cellHeight = 25;
	protected bottomMargin = 40;
	protected cellMargin = 2;
	protected noteSize = 25;

	protected panelContainer!: Phaser.GameObjects.Container;
	protected footerContainer!: Phaser.GameObjects.Container;
	protected abstract measureLength: number[];
	protected abstract measureCount: number;
	protected abstract notes: Record<string, LaneMeasureNote[]>;

	get totalWidth() {
		return this.laneConfigs.reduce((acc) => acc + this.cellWidth, 0);
	}

	get offsetX() {
		return (this.scale.width - this.totalWidth) / 2;
	}

	get offsetY() {
		return this.scale.height - this.bottomMargin;
	}

	get laneHeight() {
		return this.getTotalMesaureOffest(this.measureCount);
	}

	protected laneConfigs: LaneConfig[] = [
		{ name: 'BPM', noteColor: 0x000000, id: '08', playable: false },
		{ name: 'LC', noteColor: 0xa20814, id: '1A', playable: true, iconFrameIndex: 0, width: 74 },
		{ name: 'HH', noteColor: 0x0d1cde, id: '18', playable: true, iconFrameIndex: 1, width: 48 },
		{
			name: 'HHC',
			noteColor: 0x0d1cde,
			id: '11',
			playable: true,
			iconFrameIndex: 1,
			width: 48
		},
		{ name: 'LP', noteColor: 0xde0db8, id: '1B', playable: true, iconFrameIndex: 9, width: 58 },
		{ name: 'LB', noteColor: 0x567dcb, id: '1C', playable: true, iconFrameIndex: 9, width: 58 },
		{ name: 'SN', noteColor: 0xefec1b, id: '12', playable: true, iconFrameIndex: 4, width: 64 },
		{ name: 'HT', noteColor: 0x45ef1b, id: '14', playable: true, iconFrameIndex: 5, width: 56 },
		{ name: 'BD', noteColor: 0x567dcb, id: '13', playable: true, iconFrameIndex: 8, width: 70 },
		{ name: 'LT', noteColor: 0xef1b2b, id: '15', playable: true, iconFrameIndex: 6, width: 56 },
		{ name: 'FT', noteColor: 0xfa7e0a, id: '17', playable: true, iconFrameIndex: 7, width: 56 },
		{ name: 'CY', noteColor: 0x1424c4, id: '16', playable: true, iconFrameIndex: 2, width: 74 },
		{ name: 'RD', noteColor: 0x14bfc4, id: '19', playable: true, iconFrameIndex: 3, width: 58 },
		{ name: 'BGM', noteColor: 0x222222, id: '01', playable: false }
	];

	preload() {}

	getTotalMesaureLength(measure: number) {
		if (this.measureLength.length === 0) return measure;
		return this.measureLength.slice(0, measure).reduce((acc, length) => acc + length, 0);
	}

	getTotalMesaureOffest(measure: number) {
		let totalOffset = 0;
		for (let i = 0; i < measure; i++) {
			totalOffset += this.getMeasureHeight(i);
		}
		return totalOffset;
	}

	getMeasureHeight(measure: number) {
		const measureLength = this.measureLength[measure] || 1;
		let totalHeight = 0;

		// Sum up the height of each cell in the measure
		for (let i = 0; i < this.cellsPerMeasure; i++) {
			totalHeight += this.getCellHeight(measure, i);
		}

		return totalHeight * measureLength;
	}

	// This method is meant to be overridden by subclasses
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	getCellHeight(measure: number, cell: number) {
		return this.cellHeight;
	}

	parseMesaureLength() {
		if (!this.notes[BaseGame.measureLengthNoteID]) return;

		let currentMeasureLength = 1;
		for (let i = 0; i < this.measureCount; i++) {
			const note = this.notes[BaseGame.measureLengthNoteID].find(
				(note) => note.measure === i
			);
			if (note) {
				// For measure length notes, use the measureLength property directly
				currentMeasureLength = note.measureLength;
			}
			this.measureLength[i] = currentMeasureLength;
		}
	}

	abstract drawFooterLane(laneConfig: LaneConfig, currentX: number): void;

	drawFooter() {
		this.footerContainer = this.add.container(0, 0);
		this.footerContainer.setSize(this.scale.width, this.bottomMargin);

		// Lane indicators
		let currentX = this.offsetX;
		this.laneConfigs.forEach((laneConfig) => {
			// Add the icon sprite from the spritesheet
			this.drawFooterLane(laneConfig, currentX);

			currentX += this.cellWidth;
		});

		const graphics = this.add.graphics();
		this.drawMesaureLine(graphics, this.offsetY);
		graphics.strokePath();
		this.footerContainer.add(graphics);
	}

	drawPanel() {
		this.drawFooter();
		this.panelContainer = this.add.container(0, 0);
		const scrollableHeight = this.laneHeight + this.bottomMargin;
		this.panelContainer.setSize(this.scale.width, scrollableHeight);

		this.parseMesaureLength();
		// Constants for grid dimensions

		// Create separate graphics objects for different line thicknesses
		const verticalLines = this.add.graphics();
		const cellLines = this.add.graphics(); // thickness 2
		const beatLines = this.add.graphics(); // thickness 4
		const measureLines = this.add.graphics(); // thickness 6

		// Set line styles for each graphics object
		verticalLines.lineStyle(1, 0x888888, 1); // Light grey for vertical lanes
		cellLines.lineStyle(2, 0x888888, 0.5); // Light grey for cells
		beatLines.lineStyle(4, 0x888888, 0.5); // Light grey for beat divisions
		measureLines.lineStyle(6, 0xffffff, 0.5); // White for measure lines

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

		// Draw horizontal lines for cells and measures
		let y = this.offsetY;
		for (let j = 0; j < this.measureCount; j++) {
			const measureHeight = this.drawMeasure(j, y, cellLines, beatLines, measureLines);
			y -= measureHeight;
		}

		// Stroke all graphics objects
		verticalLines.strokePath();
		cellLines.strokePath();
		beatLines.strokePath();
		measureLines.strokePath();

		// Add all graphics to the panel container
		this.panelContainer.add(verticalLines);
		this.panelContainer.add(cellLines);
		this.panelContainer.add(beatLines);
		this.panelContainer.add(measureLines);

		this.setCameraBounds();

		const mask = this.make.graphics();
		mask.fillStyle(0xffffff);
		mask.fillRect(0, 0, this.scale.width, this.scale.height - this.bottomMargin);
		this.panelContainer.setMask(mask.createGeometryMask());
	}

	setCameraBounds() {
		this.cameras.main.setBounds(
			0,
			-this.laneHeight + this.cameras.main.height - this.bottomMargin,
			this.scale.width,
			this.laneHeight + this.bottomMargin
		);
	}

	drawMesaureLine(graphics: Phaser.GameObjects.Graphics, yStart: number) {
		graphics.lineStyle(6, 0xffffff, 0.5);
		graphics.moveTo(this.offsetX, yStart);
		graphics.lineTo(this.offsetX + this.totalWidth, yStart);
	}

	drawMeasure(
		measure: number,
		yStart: number,
		cellLines: Phaser.GameObjects.Graphics,
		beatLines: Phaser.GameObjects.Graphics,
		measureLines: Phaser.GameObjects.Graphics
	) {
		const measureLength = this.measureLength[measure] || 1;
		const cellsPerMeasure = this.cellsPerMeasure * measureLength;

		let y = yStart;
		let currentMeasureHeight = 0;

		// Draw horizontal lines for each cell in the measure
		for (let i = 0; i < cellsPerMeasure; i++) {
			const cellHeight = this.getCellHeight(measure, i % this.cellsPerMeasure);

			// Use appropriate graphics object based on beat division
			const targetGraphics = i % 4 == 0 ? beatLines : cellLines;
			targetGraphics.moveTo(this.offsetX, y);
			targetGraphics.lineTo(this.offsetX + this.totalWidth, y);

			y -= cellHeight;
			currentMeasureHeight += cellHeight;
		}

		// Draw the measure boundary line using the measure lines graphics
		measureLines.moveTo(this.offsetX, yStart);
		measureLines.lineTo(this.offsetX + this.totalWidth, yStart);

		// Calculate the middle of the measure for placing the measure number text
		const measureMiddleY = yStart - currentMeasureHeight / 2;

		const text = this.add
			.text(this.offsetX + this.totalWidth / 2, measureMiddleY, `${measure}`, {
				fontSize: '96px',
				color: '#ffffff'
			})
			.setOrigin(0.5)
			.setAlpha(0.5);
		this.panelContainer.add(text);

		return currentMeasureHeight;
	}

	drawNotes() {
		for (const [laneID, notes] of Object.entries(this.notes)) {
			notes.forEach((note) => {
				const laneIndex = this.laneConfigs.findIndex((lane) => lane.id === note.laneID);

				if (laneIndex === -1) {
					return;
				}

				// Set the measureLength for the note if it's not already set
				if (note.measureLength === 1) {
					note.measureLength = this.measureLength[note.measure] || 1;
				}

				note.notes.forEach((noteChip: { noteID: string; position: number }) => {
					this.drawNote(note.measure, laneIndex, noteChip.position, noteChip.noteID);
				});
			});
		}
	}

	/**
	 * Normalize a cell offset to prevent floating point precision issues
	 */
	protected normalizePosition(cellOffset: number): number {
		return normalizePosition(cellOffset, this.cellsPerMeasure);
	}

	drawNote(measure: number, laneIndex: number, cellOffset: number, noteId: string) {
		// Normalize the position to prevent floating point precision issues
		const normalizedCellOffset = this.normalizePosition(cellOffset);

		const x = this.offsetX + this.cellWidth * laneIndex + this.cellMargin;

		// Calculate Y position based on measure offset and cell position
		const yOffset = this.getTotalMesaureOffest(measure);

		// Calculate the position within the measure using high-resolution grid
		// This allows for proper positioning of 24th, 32nd, 48th, and 64th notes
		const { wholeCells, fractionalCell } = calculateHighResolutionPosition(
			normalizedCellOffset,
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

		const y = this.offsetY - (yOffset + cellsYOffset) + this.cellMargin - this.noteSize;

		const width = this.cellWidth - this.cellMargin * 2;
		const height = this.noteSize - this.cellMargin * 2;

		const noteKey = `note-${laneIndex}-${measure}-${normalizedCellOffset}`;
		const textKey = `text-${laneIndex}-${measure}-${normalizedCellOffset}`;
		const existingNote = this.panelContainer.getByName(noteKey);

		if (!existingNote) {
			// If the note already exists, do nothing. Otherwise, create a new note
			const graphics = this.add.graphics();
			graphics.fillStyle(this.laneConfigs[laneIndex].noteColor, 1);
			graphics.fillRect(x, y, width, height);
			graphics.setName(noteKey);
			this.panelContainer.add(graphics);

			// Draw text with noteId at the center of the note
			const text = this.add.text(x + width / 2, y + height / 2, noteId, {
				fontSize: '16px',
				color: '#ffffff',
				align: 'center'
			});
			text.setOrigin(0.5, 0.5);
			text.setName(textKey);
			this.panelContainer.add(text);

			return true;
		} else {
			return false;
		}
	}
}
