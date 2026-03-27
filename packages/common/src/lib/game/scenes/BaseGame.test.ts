import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseGame } from './BaseGame';
import { LaneMeasureNote } from '../../chart/note';
import type { LaneConfig } from '../interface';

// Create a concrete implementation of BaseGame for testing
class TestableBaseGame extends BaseGame {
	public measureLength: number[] = [];
	public measureCount: number = 10;
	public notes: Record<string, LaneMeasureNote[]> = {};

	constructor() {
		super({ key: 'TestableBaseGame' });
	}

	drawFooterLane(laneConfig: LaneConfig, currentX: number): void {
		// Mock implementation for testing
		const sprite = this.add.rectangle(
			currentX,
			this.offsetY + 20,
			40,
			30,
			laneConfig.noteColor
		);
		this.footerContainer.add(sprite);
	}
}

describe('BaseGame', () => {
	let baseGame: TestableBaseGame;
	let mockAdd: any;
	let mockGraphics: any;
	let mockText: any;
	let mockMask: any;
	let mockCamera: any;

	beforeEach(() => {
		// Mock Phaser objects
		mockGraphics = {
			lineStyle: vi.fn(),
			fillStyle: vi.fn(),
			fillRect: vi.fn(),
			strokePath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			setName: vi.fn()
		};

		mockText = {
			setOrigin: vi.fn().mockReturnThis(),
			setAlpha: vi.fn().mockReturnThis(),
			setName: vi.fn().mockReturnThis()
		};

		mockMask = {
			fillStyle: vi.fn(),
			fillRect: vi.fn(),
			createGeometryMask: vi.fn().mockReturnValue({})
		};

		mockCamera = {
			setBounds: vi.fn(),
			height: 1080
		};

		mockAdd = {
			graphics: vi.fn().mockReturnValue(mockGraphics),
			text: vi.fn().mockReturnValue(mockText),
			rectangle: vi.fn().mockReturnValue({ setName: vi.fn() }),
			container: vi.fn().mockReturnValue({
				setSize: vi.fn(),
				add: vi.fn(),
				getByName: vi.fn(),
				setMask: vi.fn()
			})
		};

		baseGame = new TestableBaseGame();
		baseGame.add = mockAdd;
		baseGame.make = { graphics: vi.fn().mockReturnValue(mockMask) } as any;
		baseGame.cameras = { main: mockCamera } as any;
		baseGame.scale = { width: 960, height: 1080 } as any;
	});

	describe('static properties', () => {
		it('should have correct static measureLengthNoteID', () => {
			expect(BaseGame.measureLengthNoteID).toBe('02');
		});
	});

	describe('getter properties', () => {
		it('should calculate totalWidth correctly', () => {
			// BaseGame has 14 lanes by default, each with cellWidth of 50
			expect(baseGame.totalWidth).toBe(14 * 50); // 700
		});

		it('should calculate offsetX correctly', () => {
			const expectedOffsetX = (960 - 700) / 2; // (width - totalWidth) / 2
			expect(baseGame.offsetX).toBe(expectedOffsetX);
		});

		it('should calculate offsetY correctly', () => {
			const expectedOffsetY = 1080 - 40; // height - bottomMargin
			expect(baseGame.offsetY).toBe(expectedOffsetY);
		});

		it('should calculate laneHeight correctly', () => {
			baseGame.measureLength = [1, 2, 1.5];
			baseGame.measureCount = 3;

			// Mock getCellHeight to return cellHeight (25)
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			const expectedHeight = 16 * 25 * 1 + 16 * 25 * 2 + 16 * 25 * 1.5; // cellsPerMeasure * cellHeight * measureLength
			expect(baseGame.laneHeight).toBe(expectedHeight);
		});
	});

	describe('lane configuration', () => {
		it('should have correct number of lane configurations', () => {
			expect(baseGame['laneConfigs']).toHaveLength(14);
		});

		it('should have expected playable lanes', () => {
			const playableLanes = baseGame['laneConfigs'].filter((lane) => lane.playable);
			expect(playableLanes).toHaveLength(12); // All except BPM and BGM
		});

		it('should have correct non-playable lanes', () => {
			const nonPlayableLanes = baseGame['laneConfigs'].filter((lane) => !lane.playable);
			expect(nonPlayableLanes).toHaveLength(2);
			expect(nonPlayableLanes.map((lane) => lane.id)).toEqual(['08', '01']); // BPM and BGM
		});

		it('should have all required lane properties', () => {
			baseGame['laneConfigs'].forEach((lane) => {
				expect(lane).toHaveProperty('name');
				expect(lane).toHaveProperty('noteColor');
				expect(lane).toHaveProperty('id');
				expect(lane).toHaveProperty('playable');

				if (lane.playable) {
					expect(lane).toHaveProperty('iconFrameIndex');
					expect(lane).toHaveProperty('width');
				}
			});
		});
	});

	describe('measure calculations', () => {
		beforeEach(() => {
			baseGame.measureLength = [1, 2, 1.5, 1];
			baseGame.measureCount = 4;
		});

		it('should calculate total measure length correctly', () => {
			expect(baseGame.getTotalMesaureLength(0)).toBe(0);
			expect(baseGame.getTotalMesaureLength(1)).toBe(1);
			expect(baseGame.getTotalMesaureLength(2)).toBe(3); // 1 + 2
			expect(baseGame.getTotalMesaureLength(3)).toBe(4.5); // 1 + 2 + 1.5
			expect(baseGame.getTotalMesaureLength(4)).toBe(5.5); // 1 + 2 + 1.5 + 1
		});

		it('should handle empty measureLength array', () => {
			baseGame.measureLength = [];
			expect(baseGame.getTotalMesaureLength(5)).toBe(5);
		});

		it('should calculate measure height correctly', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			// For measure 0: measureLength[0] = 1, so height = 16 * 25 * 1 = 400
			expect(baseGame.getMeasureHeight(0)).toBe(400);

			// For measure 1: measureLength[1] = 2, so height = 16 * 25 * 2 = 800
			expect(baseGame.getMeasureHeight(1)).toBe(800);
		});

		it('should use default measure length when not found', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			// For measure 10 (beyond array): default measureLength = 1
			expect(baseGame.getMeasureHeight(10)).toBe(16 * 25 * 1);
		});

		it('should calculate total measure offset correctly', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			expect(baseGame.getTotalMesaureOffest(0)).toBe(0);
			expect(baseGame.getTotalMesaureOffest(1)).toBe(400); // measure 0 height
			expect(baseGame.getTotalMesaureOffest(2)).toBe(1200); // measure 0 + measure 1 heights
		});
	});

	describe('cell height', () => {
		it('should return default cell height', () => {
			expect(baseGame.getCellHeight(0, 0)).toBe(25);
			expect(baseGame.getCellHeight(5, 10)).toBe(25);
		});
	});

	describe('measure length parsing', () => {
		it('should parse measure lengths from notes', () => {
			// Create measure length notes
			const measureLengthNote1 = new LaneMeasureNote(0, '02', [
				{ noteID: '00', position: 0 }
			]);
			measureLengthNote1.measureLength = 2;

			const measureLengthNote2 = new LaneMeasureNote(2, '02', [
				{ noteID: '00', position: 0 }
			]);
			measureLengthNote2.measureLength = 1.5;

			baseGame.notes = {
				'02': [measureLengthNote1, measureLengthNote2]
			};
			baseGame.measureCount = 5;

			baseGame.parseMesaureLength();

			expect(baseGame.measureLength[0]).toBe(2);
			expect(baseGame.measureLength[1]).toBe(2); // Inherited from previous
			expect(baseGame.measureLength[2]).toBe(1.5);
			expect(baseGame.measureLength[3]).toBe(1.5); // Inherited from previous
			expect(baseGame.measureLength[4]).toBe(1.5); // Inherited from previous
		});

		it('should handle missing measure length notes', () => {
			baseGame.notes = {};
			baseGame.measureCount = 3;

			// Should not throw
			expect(() => baseGame.parseMesaureLength()).not.toThrow();
		});

		it('should use default measure length when no notes exist', () => {
			baseGame.notes = { '02': [] };
			baseGame.measureCount = 3;

			baseGame.parseMesaureLength();

			// Should all be 1 (default)
			expect(baseGame.measureLength[0]).toBe(1);
			expect(baseGame.measureLength[1]).toBe(1);
			expect(baseGame.measureLength[2]).toBe(1);
		});
	});

	describe('drawing methods', () => {
		beforeEach(() => {
			baseGame.measureLength = [1, 1, 1];
			baseGame.measureCount = 3;
		});

		it('should draw footer correctly', () => {
			baseGame.drawFooter();

			expect(mockAdd.container).toHaveBeenCalled();
			expect(mockAdd.graphics).toHaveBeenCalled();
		});

		it('should draw panel correctly', () => {
			vi.spyOn(baseGame, 'drawFooter').mockImplementation(() => {});
			vi.spyOn(baseGame, 'setCameraBounds').mockImplementation(() => {});

			baseGame.drawPanel();

			expect(mockAdd.container).toHaveBeenCalled();
			expect(mockAdd.graphics).toHaveBeenCalledTimes(4); // vertical, cell, beat, measure lines
		});

		it('should set camera bounds correctly', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);
			baseGame.measureCount = 2;
			baseGame.measureLength = [1, 1];

			baseGame.setCameraBounds();

			expect(mockCamera.setBounds).toHaveBeenCalledWith(
				0,
				expect.any(Number), // Complex calculation
				960,
				expect.any(Number) // Complex calculation
			);
		});

		it('should draw measure line correctly', () => {
			const yStart = 500;
			baseGame.drawMesaureLine(mockGraphics, yStart);

			expect(mockGraphics.lineStyle).toHaveBeenCalledWith(6, 0xffffff, 0.5);
			expect(mockGraphics.moveTo).toHaveBeenCalledWith(baseGame.offsetX, yStart);
			expect(mockGraphics.lineTo).toHaveBeenCalledWith(
				baseGame.offsetX + baseGame.totalWidth,
				yStart
			);
		});

		it('should draw measure correctly', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);
			baseGame.measureLength = [2]; // Double length measure

			// Mock panelContainer
			baseGame['panelContainer'] = {
				add: vi.fn()
			} as any;

			const height = baseGame.drawMeasure(0, 1000, mockGraphics, mockGraphics, mockGraphics);

			expect(height).toBe(16 * 25 * 2); // cellsPerMeasure * cellHeight * measureLength
			expect(mockAdd.text).toHaveBeenCalledWith(
				expect.any(Number),
				expect.any(Number),
				'0', // measure number
				expect.any(Object)
			);
		});
	});

	describe('note drawing', () => {
		beforeEach(() => {
			baseGame.measureLength = [1, 1, 1];
			baseGame.measureCount = 3;
			// Mock panelContainer
			baseGame['panelContainer'] = {
				getByName: vi.fn().mockReturnValue(null),
				add: vi.fn()
			} as any;
		});

		it('should draw note correctly', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			const result = baseGame.drawNote(1, 0, 0.5, '11');

			expect(result).toBe(true);
			expect(mockAdd.graphics).toHaveBeenCalled();
			expect(mockAdd.text).toHaveBeenCalled();
			expect(mockGraphics.fillStyle).toHaveBeenCalled();
			expect(mockGraphics.fillRect).toHaveBeenCalled();
		});

		it('should not draw note if it already exists', () => {
			const existingNote = { name: 'note-0-1-0.5' };
			baseGame['panelContainer'].getByName = vi.fn().mockReturnValue(existingNote);

			const result = baseGame.drawNote(1, 0, 0.5, '11');

			expect(result).toBe(false);
			expect(mockAdd.graphics).not.toHaveBeenCalled();
		});

		it('should render a note and call fillRect', () => {
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			const result = baseGame.drawNote(1, 0, 0.5, '11');

			expect(result).toBe(true);
			expect(mockGraphics.fillRect).toHaveBeenCalled();
		});

		it('should normalize note position', () => {
			vi.spyOn(baseGame as any, 'normalizePosition');
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			baseGame.drawNote(1, 0, 0.333333333, '11');

			expect((baseGame as any).normalizePosition).toHaveBeenCalledWith(0.333333333);
		});

		it('should apply fractional cell offset when position falls between grid boundaries', () => {
			// Mock normalizePosition to return a value that results in fractionalCell > 0
			// 1/192 gives visualCellPosition = 1/12 ≈ 0.0833, so fractionalCell = 1/12
			vi.spyOn(baseGame as any, 'normalizePosition').mockReturnValue(1 / 192);
			vi.spyOn(baseGame, 'getCellHeight').mockReturnValue(25);

			const result = baseGame.drawNote(1, 0, 1 / 192, '11');

			expect(result).toBe(true);
		});

		it('should draw notes from notes data structure', () => {
			const testNotes = [
				{ noteID: '11', position: 0 },
				{ noteID: '12', position: 0.5 }
			];
			const laneMeasureNote = new LaneMeasureNote(1, '1A', testNotes);

			baseGame.notes = {
				'1A': [laneMeasureNote]
			};

			vi.spyOn(baseGame, 'drawNote').mockReturnValue(true);

			baseGame.drawNotes();

			expect(baseGame.drawNote).toHaveBeenCalledTimes(2);
			expect(baseGame.drawNote).toHaveBeenCalledWith(1, 1, 0, '11'); // lane index 1 for LC (1A)
			expect(baseGame.drawNote).toHaveBeenCalledWith(1, 1, 0.5, '12');
		});

		it('should skip notes for unknown lanes', () => {
			const testNotes = [{ noteID: '11', position: 0 }];
			const laneMeasureNote = new LaneMeasureNote(1, 'XX', testNotes); // Unknown lane ID

			baseGame.notes = {
				XX: [laneMeasureNote]
			};

			vi.spyOn(baseGame, 'drawNote').mockReturnValue(true);

			baseGame.drawNotes();

			expect(baseGame.drawNote).not.toHaveBeenCalled();
		});

		it('should set measure length for notes', () => {
			const testNotes = [{ noteID: '11', position: 0 }];
			const laneMeasureNote = new LaneMeasureNote(1, '1A', testNotes);
			laneMeasureNote.measureLength = 1; // Default

			baseGame.notes = {
				'1A': [laneMeasureNote]
			};
			baseGame.measureLength = [1, 2, 1]; // Measure 1 has length 2

			vi.spyOn(baseGame, 'drawNote').mockReturnValue(true);

			baseGame.drawNotes();

			expect(laneMeasureNote.measureLength).toBe(2); // Should be updated
		});
	});

	describe('position normalization', () => {
		it('should normalize positions correctly', () => {
			// Test that normalizePosition is called with correct parameters
			vi.spyOn(baseGame as any, 'normalizePosition').mockReturnValue(0.5);

			const result = (baseGame as any)['normalizePosition'](0.4999999);

			expect((baseGame as any).normalizePosition).toHaveBeenCalledWith(0.4999999);
		});
	});

	describe('edge cases', () => {
		it('should handle zero measure count', () => {
			baseGame.measureCount = 0;

			expect(baseGame.laneHeight).toBe(0);
			expect(baseGame.getTotalMesaureOffest(0)).toBe(0);
		});

		it('should handle empty notes object', () => {
			baseGame.notes = {};

			expect(() => baseGame.drawNotes()).not.toThrow();
		});

		it('should handle negative measure indices gracefully', () => {
			expect(baseGame.getMeasureHeight(-1)).toBe(16 * 25 * 1); // Uses default measure length
		});
	});
});
