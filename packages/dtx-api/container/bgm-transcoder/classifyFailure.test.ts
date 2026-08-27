import { describe, expect, it } from 'bun:test';
import { classifyFfmpegFailure } from './classifyFailure';

describe('classifyFfmpegFailure', () => {
	it.each([
		'Invalid data found when processing input',
		'Could not find codec parameters for stream 0',
		'moov atom not found',
		'Stream map 0:a:0 matches no streams',
		'Input file does not contain any stream',
		'Error while decoding stream #0:0: Invalid data found when processing input',
		'Error submitting packet to decoder: Invalid data found when processing input',
		'Decoder (codec foo) not found for input stream #0:0'
	])('classifies malformed or undecodable input as unprocessable: %s', (stderr) => {
		expect(classifyFfmpegFailure(stderr)).toBe('unprocessable');
	});

	it.each([
		'Error opening input file /tmp/input: Permission denied',
		'Error opening input file /tmp/input: EACCES',
		'Error opening input file /tmp/input: No space left on device',
		'Error initializing output stream 0:0 -- Error while opening encoder',
		'Error writing trailer of output.m4a: No space left on device',
		'Conversion failed!',
		''
	])('classifies non-input and unknown failures as internal: %s', (stderr) => {
		expect(classifyFfmpegFailure(stderr)).toBe('internal');
	});
});
