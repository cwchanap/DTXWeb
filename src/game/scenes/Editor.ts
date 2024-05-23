import { Scene, Input } from 'phaser';

interface LaneConfig {
	name: string;
}

interface Data {
    measureCount?: number;
}

export class Editor extends Scene {
	private laneConfigs: LaneConfig[] = [
		{ name: 'LC' },
		{ name: 'HH' },
		{ name: 'LP' },
		{ name: 'LB' },
		{ name: 'SN' },
		{ name: 'HT' },
		{ name: 'BD' },
		{ name: 'LT' },
		{ name: 'FT' },
		{ name: 'CY' },
		{ name: 'RD' }
	];

	private cellsPerMeasure = 16;
	private cellWidth = 50;
	private cellHeight = 25;
	private bottomMargin = 40;
    public static key = 'Editor';

	constructor(private measureCount: number = 9) {
		super({ key: Editor.key });
	}

    init(data: Data) {
        this.measureCount = data.measureCount || this.measureCount;
    }

	preload() {
		// Preload assets if any
	}

	create() {
		// Constants for grid dimensions
		const cellMargin = 2; // Margin between cells
		const measureHeight = this.cellHeight * this.cellsPerMeasure;
		const laneHeight = this.measureCount * measureHeight;

		// Calculate total width based on lane configurations
		const totalWidth = this.laneConfigs.reduce((acc) => acc + this.cellWidth, 0);
		const offsetX = (this.scale.width - totalWidth) / 2;
		const offsetY = this.scale.height - this.bottomMargin; // Adjusted for indicators

		const graphics = this.add.graphics();
		graphics.lineStyle(1, 0x888888, 1); // Light grey for cells
		graphics.lineStyle(2, 0xffffff, 1); // White for measure lines

		// Draw vertical lanes
		let currentX = offsetX;
		this.laneConfigs.forEach((laneConfig, index) => {
			graphics.moveTo(currentX, offsetY);
			graphics.lineTo(currentX, offsetY - laneHeight);
			graphics.strokePath();
			currentX += this.cellWidth;
		});

		// Draw the last vertical line
		graphics.moveTo(currentX, offsetY);
		graphics.lineTo(currentX, offsetY - laneHeight);
		graphics.strokePath();

		// Lane indicators
		currentX = offsetX;
		this.laneConfigs.forEach((laneConfig, index) => {
			this.add
				.text(currentX + this.cellWidth / 2, offsetY + 20, laneConfig.name, {
					fontSize: '16px',
					color: '#ffffff'
				})
				.setOrigin(0.5);
			currentX += this.cellWidth;
		});

		// Draw horizontal lines for cells and measures
		for (let j = 0; j <= this.measureCount * this.cellsPerMeasure; j++) {
			const y = offsetY - j * this.cellHeight;
			const isMeasureLine = j % this.cellsPerMeasure === 0;
			graphics.lineStyle(isMeasureLine ? 4 : 1, isMeasureLine ? 0xffffff : 0x888888, 1); // Thicker border for measures
			graphics.moveTo(offsetX, y);
			graphics.lineTo(offsetX + totalWidth, y); // Ensure the line extends the full width
			graphics.strokePath();

			if (isMeasureLine && j < this.measureCount * this.cellsPerMeasure) {
				const measureNumber = j / this.cellsPerMeasure + 1;
				this.add
					.text(
						offsetX + totalWidth / 2,
						y - (this.cellsPerMeasure * this.cellHeight) / 2,
						`${measureNumber}`,
						{
							fontSize: '96px',
							color: '#ffffff'
						}
					)
					.setOrigin(0.5)
					.setAlpha(0.5);
			}
		}

		// Enable input events
		this.input.on('pointerdown', (pointer: Input.Pointer) => {
			const x = pointer.x - offsetX;
			const y = pointer.y - offsetY;

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
				this.drawNote(laneIndex, cellIndex, cellMargin, offsetX, offsetY);
			}
		});

		// Make the scene scrollable
		this.cameras.main.setBounds(
			0,
			-laneHeight + this.cameras.main.height - this.bottomMargin,
			this.scale.width,
			laneHeight + this.bottomMargin
		);
		this.cameras.main.setScroll(0, 0);

		this.input.on(
			'wheel',
			(
				pointer: Phaser.Input.Pointer,
				gameObjects: any,
				deltaX: number,
				deltaY: number,
				deltaZ: number
			) => {
				this.cameras.main.scrollY += deltaY * 0.1;
			}
		);
	}

	drawNote(
		laneIndex: number,
		cellIndex: number,
		cellMargin: number,
		offsetX: number,
		offsetY: number
	) {
		const x = offsetX + this.cellWidth * laneIndex + cellMargin;
		const y =
			offsetY -
			cellIndex * this.cellHeight -
			cellMargin +
			this.cameras.main.scrollY - this.cellHeight;
		const width = this.cellWidth - cellMargin * 2;
		const height = this.cellHeight - cellMargin * 2;

		const noteKey = `note-${laneIndex}-${cellIndex}`;
		const existingNote = this.children.getByName(noteKey);

		if (existingNote) {
			// If the note already exists, remove it
			existingNote.destroy();
		} else {
			// Otherwise, create a new note
			const graphics = this.add.graphics();
			graphics.fillStyle(0xff0000, 1); // Red color for the note
			graphics.fillRect(x, y, width, height);
			graphics.setName(noteKey);
		}
	}

	update() {
		// Update logic if needed
	}
}
