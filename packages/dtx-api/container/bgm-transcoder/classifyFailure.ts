export type FfmpegFailureKind = 'unprocessable' | 'internal';

const INPUT_FAILURE_PATTERNS = [
	/invalid data found when processing input/i,
	/error opening input/i,
	/could not find codec parameters/i,
	/moov atom not found/i,
	/matches no streams/i,
	/does not contain any stream/i,
	/error while decoding stream/i,
	/error submitting packet to decoder/i,
	/decoder .+ not found for input stream/i
];

export const classifyFfmpegFailure = (stderr: string): FfmpegFailureKind =>
	INPUT_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr)) ? 'unprocessable' : 'internal';
