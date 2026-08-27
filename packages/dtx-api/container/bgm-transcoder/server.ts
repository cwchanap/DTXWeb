import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { classifyFfmpegFailure } from './classifyFailure';

const PORT = 8080;
const TRANSCODE_PATH = '/transcode/to-m4a';

class UnprocessableAudioError extends Error {}

class TranscoderProcessError extends Error {
	constructor(command: string, cause: unknown) {
		super(`Unable to run ${command}`, { cause });
	}
}

let transcodeTail: Promise<void> = Promise.resolve();

const serializeTranscode = <T>(operation: () => Promise<T>): Promise<T> => {
	const queued = transcodeTail.then(operation, operation);
	transcodeTail = queued.then(
		() => undefined,
		() => undefined
	);
	return queued;
};

const runFfmpeg = async (inputPath: string, outputPath: string): Promise<void> => {
	let process: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;

	try {
		process = Bun.spawn(
			[
				'ffmpeg',
				'-nostdin',
				'-hide_banner',
				'-loglevel',
				'error',
				'-i',
				inputPath,
				'-map',
				'0:a:0',
				'-vn',
				'-c:a',
				'aac',
				'-profile:a',
				'aac_low',
				'-b:a',
				'192k',
				'-movflags',
				'+faststart',
				'-f',
				'mp4',
				outputPath
			],
			{
				stdin: 'ignore',
				stdout: 'ignore',
				stderr: 'pipe'
			}
		);
	} catch (error) {
		throw new TranscoderProcessError('ffmpeg', error);
	}

	let exitCode: number;
	let stderr: string;
	try {
		[exitCode, stderr] = await Promise.all([
			process.exited,
			new Response(process.stderr).text()
		]);
	} catch (error) {
		throw new TranscoderProcessError('ffmpeg', error);
	}

	if (exitCode !== 0) {
		if (classifyFfmpegFailure(stderr) === 'unprocessable') {
			throw new UnprocessableAudioError('FFmpeg could not decode the input audio');
		}

		throw new TranscoderProcessError(
			'ffmpeg',
			new Error(`FFmpeg exited with code ${exitCode}: ${stderr.trim() || 'no error output'}`)
		);
	}
};

const probeOutputCodec = async (outputPath: string): Promise<string> => {
	let process: Bun.Subprocess<'ignore', 'pipe', 'ignore'>;

	try {
		process = Bun.spawn(
			[
				'ffprobe',
				'-v',
				'error',
				'-select_streams',
				'a:0',
				'-show_entries',
				'stream=codec_name',
				'-of',
				'default=noprint_wrappers=1:nokey=1',
				outputPath
			],
			{
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'ignore'
			}
		);
	} catch (error) {
		throw new TranscoderProcessError('ffprobe', error);
	}

	let exitCode: number;
	let codec: string;
	try {
		[exitCode, codec] = await Promise.all([
			process.exited,
			new Response(process.stdout).text()
		]);
	} catch (error) {
		throw new TranscoderProcessError('ffprobe', error);
	}

	if (exitCode !== 0) {
		throw new TranscoderProcessError(
			'ffprobe',
			new Error(`FFprobe exited with code ${exitCode} while inspecting transcoded audio`)
		);
	}

	return codec.trim();
};

const transcodeAndValidate = async (inputPath: string, outputPath: string): Promise<void> => {
	await runFfmpeg(inputPath, outputPath);

	const codec = await probeOutputCodec(outputPath);
	if (codec !== 'aac') {
		throw new Error(`Unexpected output codec: ${codec || 'none'}`);
	}
};

const cleanupDirectory = async (directory: string): Promise<void> => {
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		console.error(`Unable to clean up temporary directory ${directory}`, error);
	}
};

const createResponseStream = (
	outputPath: string,
	temporaryDirectory: string
): ReadableStream<Uint8Array> => {
	const reader = Bun.file(outputPath).stream().getReader();
	let cleanupPromise: Promise<void> | undefined;

	const cleanup = (): Promise<void> => {
		cleanupPromise ??= cleanupDirectory(temporaryDirectory);
		return cleanupPromise;
	};

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					await cleanup();
					return;
				}

				controller.enqueue(value);
			} catch (error) {
				controller.error(error);
				await cleanup();
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				await cleanup();
			}
		}
	});
};

const handleTranscode = async (request: Request): Promise<Response> => {
	if (request.body === null) {
		return new Response('The request body must contain audio', { status: 422 });
	}

	let temporaryDirectory: string | undefined;
	let responseOwnsCleanup = false;

	try {
		temporaryDirectory = await mkdtemp(join(tmpdir(), 'bgm-transcoder-'));
		const inputPath = join(temporaryDirectory, 'input');
		const outputPath = join(temporaryDirectory, 'output.m4a');

		await pipeline(
			Readable.fromWeb(request.body as globalThis.ReadableStream<Uint8Array>),
			createWriteStream(inputPath, { flags: 'wx' })
		);

		await serializeTranscode(() => transcodeAndValidate(inputPath, outputPath));

		const outputStat = await stat(outputPath);
		const responseBody = createResponseStream(outputPath, temporaryDirectory);
		const response = new Response(responseBody, {
			status: 200,
			headers: {
				'Content-Length': outputStat.size.toString(),
				'Content-Type': 'audio/mp4'
			}
		});
		responseOwnsCleanup = true;
		return response;
	} catch (error) {
		if (error instanceof UnprocessableAudioError) {
			return new Response('The source does not contain decodable audio', { status: 422 });
		}

		console.error('Audio transcode failed', error);
		return new Response('Internal transcoder error', { status: 500 });
	} finally {
		if (temporaryDirectory !== undefined && !responseOwnsCleanup) {
			await cleanupDirectory(temporaryDirectory);
		}
	}
};

Bun.serve({
	port: PORT,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname !== TRANSCODE_PATH) {
			return new Response('Not found', { status: 404 });
		}
		if (request.method !== 'POST') {
			return new Response('Method not allowed', {
				status: 405,
				headers: { Allow: 'POST' }
			});
		}

		return handleTranscode(request);
	},
	error(error) {
		console.error('Unhandled transcoder server error', error);
		return new Response('Internal transcoder error', { status: 500 });
	}
});
