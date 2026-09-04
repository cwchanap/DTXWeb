export type FfmpegFailureKind = 'unprocessable' | 'internal';

const INTERNAL_IO_FAILURE_PATTERNS = [
	/permission denied/i,
	/\bEACCES\b/i,
	/no space left on device/i,
	/\bENOSPC\b/i,
	/input\/output error/i,
	/\bEIO\b/i,
	/read-only file system/i,
	/no such file or directory/i,
	/too many open files/i,
	/resource temporarily unavailable/i
];

const INPUT_FAILURE_PATTERNS = [
	/invalid data found when processing input/i,
	/could not find codec parameters/i,
	/moov atom not found/i,
	/matches no streams/i,
	/does not contain any stream/i,
	/error while decoding stream/i,
	/error submitting packet to decoder/i,
	/decoder .+ not found for input stream/i
];

export const classifyFfmpegFailure = (stderr: string): FfmpegFailureKind => {
	if (INTERNAL_IO_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr))) {
		return 'internal';
	}

	return INPUT_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr))
		? 'unprocessable'
		: 'internal';
};
