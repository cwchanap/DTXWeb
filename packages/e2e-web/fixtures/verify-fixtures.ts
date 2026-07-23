// Verify the generated MIDI fixtures are valid
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MidiFileInfo {
	filename: string;
	size: number;
	isValid: boolean;
	format?: number;
	trackCount?: number;
	ticksPerQuarter?: number;
	error?: string;
}

function readUint16BE(buffer: Uint8Array, offset: number): number {
	return (buffer[offset] << 8) | buffer[offset + 1];
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
	return (
		(buffer[offset] << 24) |
		(buffer[offset + 1] << 16) |
		(buffer[offset + 2] << 8) |
		buffer[offset + 3]
	);
}

function verifyMidiFile(filepath: string): MidiFileInfo {
	const filename = path.basename(filepath);

	try {
		const buffer = readFileSync(filepath);
		const data = new Uint8Array(buffer);

		// Check minimum size for MIDI header
		if (data.length < 14) {
			return {
				filename,
				size: data.length,
				isValid: false,
				error: 'File too small for MIDI header'
			};
		}

		// Check MIDI header signature
		const headerSig = String.fromCharCode(data[0], data[1], data[2], data[3]);
		if (headerSig !== 'MThd') {
			return {
				filename,
				size: data.length,
				isValid: false,
				error: `Invalid header signature: ${headerSig}`
			};
		}

		// Read header information
		const headerLength = readUint32BE(data, 4);
		const format = readUint16BE(data, 8);
		const trackCount = readUint16BE(data, 10);
		const ticksPerQuarter = readUint16BE(data, 12);

		if (headerLength !== 6) {
			return {
				filename,
				size: data.length,
				isValid: false,
				error: `Invalid header length: ${headerLength}`
			};
		}

		// Verify track chunks exist
		let offset = 14;
		let actualTrackCount = 0;

		while (offset < data.length) {
			if (offset + 8 > data.length) {
				break;
			}

			const trackSig = String.fromCharCode(
				data[offset],
				data[offset + 1],
				data[offset + 2],
				data[offset + 3]
			);
			if (trackSig !== 'MTrk') {
				break;
			}

			const trackLength = readUint32BE(data, offset + 4);
			offset += 8 + trackLength;
			actualTrackCount++;
		}

		if (actualTrackCount !== trackCount) {
			return {
				filename,
				size: data.length,
				isValid: false,
				error: `Track count mismatch: expected ${trackCount}, found ${actualTrackCount}`
			};
		}

		return {
			filename,
			size: data.length,
			isValid: true,
			format,
			trackCount,
			ticksPerQuarter
		};
	} catch (error) {
		return {
			filename,
			size: 0,
			isValid: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

// Verify all MIDI fixtures
const fixtures: MidiFileInfo[] = [
	verifyMidiFile(path.join(__dirname, 'test-sample.mid')),
	verifyMidiFile(path.join(__dirname, 'empty-sample.mid')),
	verifyMidiFile(path.join(__dirname, 'multi-track-sample.mid'))
];

console.log('🔍 Verifying MIDI fixtures...\n');

fixtures.forEach((fixture) => {
	console.log(`📄 ${fixture.filename}:`);
	console.log(`   Size: ${fixture.size} bytes`);

	if (fixture.isValid) {
		console.log('   ✅ Valid MIDI file');
		console.log(`   Format: ${fixture.format}`);
		console.log(`   Tracks: ${fixture.trackCount}`);
		console.log(`   Ticks per quarter: ${fixture.ticksPerQuarter}`);
	} else {
		console.log('   ❌ Invalid MIDI file');
		console.log(`   Error: ${fixture.error}`);
	}
	console.log('');
});

// Summary
const validCount = fixtures.filter((f) => f.isValid).length;
const totalCount = fixtures.length;

console.log(`📊 Summary: ${validCount}/${totalCount} fixtures are valid MIDI files`);

if (validCount === totalCount) {
	console.log('🎯 All fixtures verified successfully!');
	process.exit(0);
} else {
	console.log('⚠️  Some fixtures have issues');
	process.exit(1);
}
