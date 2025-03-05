import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Preview } from './Preview'; // Adjust this import path as needed

// Mock dependencies
vi.mock('../EventBus');
vi.mock('$lib/browser/audioDecoder');

describe('Preview.getTimeElapsed', () => {
	let preview: Preview;

	beforeEach(() => {
		// Create a minimal instance of Preview with just what we need for getTimeElapsed
		preview = {
			bpm: 120,
			measureLength: {},
			notes: {},
			bpmNotes: {}
		} as unknown as Preview;

		// Add the getTimeElapsed method to our minimal instance
		preview.getTimeElapsed = Preview.prototype.getTimeElapsed;
		preview.getTimeForPartialMeasure = Preview.prototype.getTimeForPartialMeasure;
	});

	it('should calculate correct time for a simple case with constant BPM', () => {
		preview.bpm = 120; // 120 BPM
		preview.measureLength = { 0: 1, 1: 1 }; // Standard measure lengths
		preview.notes = { [Preview.bpmNoteID]: [] }; // No BPM changes

		// At 120 BPM, one measure (4 beats) takes 2 seconds
		expect(preview.getTimeElapsed(1, 0)).toBeCloseTo(2, 2); // 1 measure = 2 seconds
		expect(preview.getTimeElapsed(2, 0)).toBeCloseTo(4, 2); // 2 measures = 4 seconds
		expect(preview.getTimeElapsed(0, 0.5)).toBeCloseTo(1, 2); // Half a measure = 1 second
		expect(preview.getTimeElapsed(1, 0.5)).toBeCloseTo(3, 2); // 1.5 measures = 3 seconds
	});

	it('should handle different BPMs correctly', () => {
		preview.bpm = 60; // 60 BPM
		preview.measureLength = { 0: 1, 1: 1 }; // Standard measure lengths
		preview.notes = { [Preview.bpmNoteID]: [] }; // No BPM changes

		// At 60 BPM, one measure (4 beats) takes 4 seconds
		expect(preview.getTimeElapsed(1, 0)).toBeCloseTo(4, 2); // 1 measure = 4 seconds
		expect(preview.getTimeElapsed(2, 0)).toBeCloseTo(8, 2); // 2 measures = 8 seconds
	});

	it('should handle BPM changes between measures', () => {
		preview.bpm = 120; // Starting BPM
		preview.measureLength = { 0: 1, 1: 1 }; // Standard measure lengths
		preview.bpmNotes = { '01': 60 }; // BPM note with ID '01' changes to 60 BPM

		// Create a BPM change at the start of measure 1
		preview.notes = {
			[Preview.bpmNoteID]: [
				{ measure: 0, pattern: '0100' } // Change to 60 BPM at the start of measure 0
			]
		};

		// Measure 0 should now be at 60 BPM (4 seconds per measure)
		expect(preview.getTimeElapsed(1, 0)).toBeCloseTo(4, 2); // 1 measure at 60 BPM = 4 seconds
		expect(preview.getTimeElapsed(2, 0)).toBeCloseTo(8, 2); // 2 measures at 60 BPM = 8 seconds
	});

	it('should handle BPM changes within a measure', () => {
		preview.bpm = 120; // Starting BPM
		preview.measureLength = { 0: 1 }; // Standard measure length
		preview.bpmNotes = { '01': 60, '02': 240 }; // BPM notes

		// Create BPM changes within measure 0
		preview.notes = {
			[Preview.bpmNoteID]: [
				{
					measure: 0,
					pattern: '0001020000'
					// In a 5-segment measure:
					// First segment: no change (120 BPM)
					// Second segment: change to 60 BPM at position 0.2
					// Third segment: change to 240 BPM at position 0.4
					// Fourth and Fifth segments: no further changes
				}
			]
		};

		// First 0.2 of the measure at 120 BPM = 0.4 seconds
		// Next 0.2 of the measure at 60 BPM = 0.8 seconds
		// Final 0.6 of the measure at 240 BPM = 0.6 seconds
		// Total for measure 0 = 1.8 seconds
		expect(preview.getTimeElapsed(0, 0.2)).toBeCloseTo(0.4, 2); // First segment at 120 BPM
		expect(preview.getTimeElapsed(0, 0.4)).toBeCloseTo(1.2, 2); // First + Second segments
		expect(preview.getTimeElapsed(0, 1.0)).toBeCloseTo(1.8, 2); // Complete measure
		expect(preview.getTimeElapsed(1, 0)).toBeCloseTo(1.8, 2); // Also complete measure
	});

	it('should handle different measure lengths', () => {
		preview.bpm = 120; // 120 BPM
		preview.measureLength = { 0: 0.5, 1: 2 }; // Measure 0 is half-length, measure 1 is double
		preview.notes = { [Preview.bpmNoteID]: [] }; // No BPM changes

		// At 120 BPM, a standard measure (4 beats) takes 2 seconds
		// Measure 0 (0.5x) = 1 second
		// Measure 1 (2x) = 4 seconds
		expect(preview.getTimeElapsed(1, 0)).toBeCloseTo(1, 2); // Measure 0 = 1 second
		expect(preview.getTimeElapsed(2, 0)).toBeCloseTo(5, 2); // Measures 0+1 = 5 seconds
	});

	it('should calculate correct seek time for notes before start point', () => {
		preview.bpm = 120; // 120 BPM
		preview.measureLength = { 0: 1, 1: 1, 2: 1 }; // Standard measure lengths
		preview.notes = { [Preview.bpmNoteID]: [] }; // No BPM changes

		// If we start at measure 2, notes in measures 0 and 1 should have negative delays
		const measure0Time = preview.getTimeElapsed(0, 0.5); // Time at measure 0, position 0.5
		const measure2Time = preview.getTimeElapsed(2); // Time at start of measure 2

		// The "seek" would be the difference between these times
		const seekTime = measure2Time - measure0Time;
		expect(seekTime).toBeCloseTo(3, 2); // Should be about 3 seconds
	});
});
