import { LaneMeasureNote } from "@/lib/chart/note";
import { Scene, GameObjects } from "phaser";

interface LaneConfig {
    name: string;
    noteColor: number;
    id: string;
    playable: boolean;
}

export interface Note {
    measure: number;
    laneID: string;
    pattern: string;
    laneMeasureNote?: LaneMeasureNote;
}

export abstract class BaseGame extends Scene {
    static measureLengthNoteID = '02';
    protected cellsPerMeasure = 16;
    protected cellWidth = 50;
    protected cellHeight = 25;
    protected bottomMargin = 40;
    protected cellMargin = 2;
    protected noteSize = 25;

    protected panelContainer!: GameObjects.Container;
    protected footerContainer!: GameObjects.Container;
    protected abstract measureLength: number[];
    protected abstract measureCount: number;
    protected abstract notes: Record<string, Note[]>;


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
        return this.getTotalMesaureOffest(this.measureCount)
    }

    protected laneConfigs: LaneConfig[] = [
        { name: 'BPM', noteColor: 0x000000, id: '08', playable: false },
        { name: 'LC', noteColor: 0xa20814, id: '1A', playable: true },
        { name: 'HH', noteColor: 0x0d1cde, id: '18', playable: true },
        { name: 'HHC', noteColor: 0x0d1cde, id: '11', playable: true },
        { name: 'LP', noteColor: 0xde0db8, id: '1B', playable: true },
        { name: 'LB', noteColor: 0x567dcb, id: '1C', playable: true },
        { name: 'SN', noteColor: 0xefec1b, id: '12', playable: true },
        { name: 'HT', noteColor: 0x45ef1b, id: '14', playable: true },
        { name: 'BD', noteColor: 0x567dcb, id: '13', playable: true },
        { name: 'LT', noteColor: 0xef1b2b, id: '15', playable: true },
        { name: 'FT', noteColor: 0xfa7e0a, id: '17', playable: true },
        { name: 'CY', noteColor: 0x1424c4, id: '16', playable: true },
        { name: 'RD', noteColor: 0x14bfc4, id: '19', playable: true },
        { name: 'BGM', noteColor: 0x222222, id: '01', playable: false }
    ];


    getTotalMesaureLength(measure: number) {
        if (this.measureLength.length === 0) return measure;
        return this.measureLength.slice(0, measure).reduce((acc, length) => acc + length, 0);
    }

    getTotalMesaureOffest(measure: number) {
        return this.getTotalMesaureLength(measure) * this.cellHeight * this.cellsPerMeasure;
    }

	parseMesaureLength() {
		if (!this.notes[BaseGame.measureLengthNoteID]) return;

		let currentMeasureLength = 1;
		for (let i = 0; i < this.measureCount; i++) {
			const note = this.notes[BaseGame.measureLengthNoteID].find((note) => note.measure === i)
			if (note) {
				currentMeasureLength = parseFloat(note.pattern);
			}
			this.measureLength[i] = currentMeasureLength;
		}
	}

    drawFooter() {
        this.footerContainer = this.add.container(0, 0);
        this.footerContainer.setSize(this.scale.width, this.bottomMargin);
        // Lane indicators
        let currentX = this.offsetX;
        this.laneConfigs.forEach((laneConfig, index) => {
            const text = this.add
                .text(currentX + this.cellWidth / 2, this.offsetY + 20, laneConfig.name, {
                    fontSize: '16px',
                    color: '#ffffff'
                })
                .setOrigin(0.5);
            this.footerContainer.add(text);
            currentX += this.cellWidth;
        });
        const graphics = this.add.graphics();
        this.drawMesaureLine(graphics, this.offsetY);
        graphics.strokePath();
        this.footerContainer.add(graphics);
    }

    drawPanel() {
        this.panelContainer = this.add.container(0, 0);
        const scrollableHeight = this.laneHeight + this.bottomMargin;
        this.panelContainer.setSize(this.scale.width, scrollableHeight);

        this.parseMesaureLength();
        // Constants for grid dimensions

        const graphics = this.add.graphics();
        graphics.lineStyle(1, 0x888888, 1); // Light grey for cells
        graphics.lineStyle(2, 0xffffff, 1); // White for measure lines

        // Draw vertical lanes
        let currentX = this.offsetX;
        this.laneConfigs.forEach((laneConfig, index) => {
            graphics.moveTo(currentX, this.offsetY);
            graphics.lineTo(currentX, this.offsetY - this.laneHeight);
            currentX += this.cellWidth;
        });

        // Draw the last vertical line
        graphics.moveTo(currentX, this.offsetY);
        graphics.lineTo(currentX, this.offsetY - this.laneHeight);

        // Draw horizontal lines for cells and measures
        let y = this.offsetY;
        for (let j = 0; j < this.measureCount; j++) {
            this.drawMeasure(j, y, graphics);
            y -= this.cellHeight * this.cellsPerMeasure * (this.measureLength[j] || 1);
        }

        graphics.strokePath();

        this.panelContainer.add(graphics);
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

    drawMeasure(measure: number, yStart: number, graphics: Phaser.GameObjects.Graphics) {
        const cellsPerMeasure = this.cellsPerMeasure * (this.measureLength[measure] || 1);

        for (let i = 0; i < cellsPerMeasure; i++) {
            graphics.lineStyle((i * 4 % cellsPerMeasure == 0) ? 4 : 2, 0x888888, 0.5);
            graphics.moveTo(this.offsetX, yStart);
            graphics.lineTo(this.offsetX + this.totalWidth, yStart);
            yStart -= this.cellHeight;
        }

        this.drawMesaureLine(graphics, yStart);        

        const text = this.add
            .text(
                this.offsetX + this.totalWidth / 2,
                yStart + (this.cellsPerMeasure * this.cellHeight) / 2,
                `${measure}`,
                {
                    fontSize: '96px',
                    color: '#ffffff'
                }
            )
            .setOrigin(0.5)
            .setAlpha(0.5);
        this.panelContainer.add(text);
    }

	drawNotes() {
		for (const [measure, notes] of Object.entries(this.notes)) {
			notes.forEach((note) => {
				const laneIndex = this.laneConfigs.findIndex((lane) => lane.id === note.laneID);

				if (laneIndex === -1) return;
				const measureLength = this.measureLength[note.measure] || 1;
				const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);

				laneMeasureNote.notes.forEach((noteChip) => {
					this.drawNote(note.measure, laneIndex, noteChip.position, noteChip.noteID);
				});
			});
		}
	}

    drawNote(
        measure: number,
        laneIndex: number,
        cellOffset: number,
        noteId: string
    ) {
        const x = this.offsetX + this.cellWidth * laneIndex + this.cellMargin;
        const y =
            this.offsetY -
            (this.getTotalMesaureOffest(measure) + (cellOffset) * this.cellHeight * this.cellsPerMeasure) +
            this.cellMargin -
            this.noteSize;
        const width = this.cellWidth - this.cellMargin * 2;
        const height = this.noteSize - this.cellMargin * 2;

        const noteKey = `note-${laneIndex}-${measure}-${cellOffset}`;
        const existingNote = this.children.getByName(noteKey);

        if (existingNote) {
            // If the note already exists, remove it
            this.children.getAll('name', noteKey).forEach((note) => {
                note.destroy();
            });
        } else {
            // Otherwise, create a new note
            const graphics = this.add.graphics();
            graphics.fillStyle(this.laneConfigs[laneIndex].noteColor, 1); // Red color for the note
            graphics.fillRect(x, y, width, height);
            graphics.setName(noteKey);
            this.panelContainer.add(graphics);
            // draw text with note Id at the center of the note
            const text = this.add.text(x + width / 2, y + height / 2, noteId, {
                fontSize: '16px',
                color: '#ffffff',
                align: 'center',
            });
            text.setOrigin(0.5, 0.5)
            text.setName(noteKey);
            this.panelContainer.add(text);
        }
    }
}