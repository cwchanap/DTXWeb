import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface SimFileMetadata {
	title: string;
	levels: {
		[key: number]:
			| {
					label: string;
					fileName: string;
			  }
			| undefined;
	};
}

async function parseDefFileContent(content: string): Promise<SimFileMetadata> {
	const lines = content.split(/\r?\n/);

	// Extract title
	const titleLine = lines.find((line: string) => line.startsWith('#TITLE '));
	const title = titleLine ? titleLine.split('#TITLE ')[1] : '';

	// Extract level information
	const levels: SimFileMetadata['levels'] = {};

	for (let level = 1; level <= 5; level++) {
		const labelLine = lines.find((line: string) => line.startsWith(`#L${level}LABEL `));
		const fileLine = lines.find((line: string) => line.startsWith(`#L${level}FILE `));

		if (labelLine && fileLine) {
			const label = labelLine.split(' ')[1];
			const fileName = fileLine.split(' ')[1];
			levels[level] = { label, fileName };
		}
	}

	return { title, levels };
}

export const load: PageServerLoad = async ({ params, platform }) => {
	const { simfileID } = params;

	// If no simfileID, return empty metadata (local file mode)
	if (!simfileID) {
		return {
			simfileID: null,
			metadata: null
		};
	}

	// Get R2 bucket from platform
	const bucket = platform?.env?.DTXFILE_BUCKET;

	// Check if bucket is a ProxyStub (development) or real R2 bucket (production)
	// ProxyStub toString() returns "[object R2Bucket]" in development
	const bucketString = bucket?.toString() || '';
	const isProxyStub = bucketString === '[object R2Bucket]';

	if (!bucket || isProxyStub) {
		// During development, R2 bucket is either missing or a ProxyStub
		// Return null metadata to trigger client-side fetching
		return {
			simfileID,
			metadata: null
		};
	}

	try {
		// Fetch set.def file from R2
		const defObject = await bucket.get(`${simfileID}/set.def`);
		if (!defObject) {
			throw error(404, `SimFile ${simfileID} not found`);
		}

		// Convert R2Object to File for encoding detection
		const arrayBuffer = await defObject.arrayBuffer();
		const textContent = new TextDecoder('utf-8').decode(arrayBuffer);

		// Parse the def file content
		const metadata = await parseDefFileContent(textContent);

		return {
			simfileID,
			metadata
		};
	} catch (err) {
		console.error('Error loading simfile metadata:', err);

		// If this is already an HttpError from SvelteKit, re-throw it
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		// For other errors, create a proper error response
		const errorMessage = err instanceof Error ? err.message : 'Unknown error';
		throw error(500, `Failed to load simfile metadata: ${errorMessage}`);
	}
};
