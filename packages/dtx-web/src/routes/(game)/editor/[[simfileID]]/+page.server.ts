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

	// Extract title - handle both space and colon separators
	const titleLine = lines.find((line: string) => line.startsWith('#TITLE'));
	let title = '';
	if (titleLine) {
		if (titleLine.includes(':')) {
			title = titleLine.split(':')[1]?.trim() || '';
		} else {
			title = titleLine.split('#TITLE ')[1]?.trim() || '';
		}
	}

	// Extract level information - use regex for more robust parsing
	const levels: SimFileMetadata['levels'] = {};
	const levelPattern = /^#L(\d+)(LABEL|FILE)(?:\s*:\s*|\s+)(.+)$/;

	const levelData: Record<number, { label?: string; fileName?: string }> = {};

	lines.forEach((line: string) => {
		const match = line.match(levelPattern);
		if (match) {
			const level = parseInt(match[1], 10);
			const type = match[2];
			const value = match[3].trim();

			if (!levelData[level]) {
				levelData[level] = {};
			}

			if (type === 'LABEL') {
				levelData[level].label = value;
			} else if (type === 'FILE') {
				levelData[level].fileName = value;
			}
		}
	});

	// Convert to final format, only including complete entries
	Object.entries(levelData).forEach(([level, data]) => {
		if (data.label && data.fileName) {
			levels[parseInt(level, 10)] = {
				label: data.label,
				fileName: data.fileName
			};
		}
	});

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

	if (!bucket) {
		// R2 bucket is unavailable — trigger client-side fetching
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

		// Convert R2Object to File and detect encoding with BOM support
		const arrayBuffer = await defObject.arrayBuffer();

		// Detect BOM and decode accordingly
		let textContent: string;
		const uint8 = new Uint8Array(arrayBuffer);
		if (uint8[0] === 0xff && uint8[1] === 0xfe) {
			// UTF-16LE BOM
			textContent = new TextDecoder('utf-16le').decode(arrayBuffer);
			// Remove BOM if present
			if (textContent.charCodeAt(0) === 0xfeff) {
				textContent = textContent.slice(1);
			}
		} else if (uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
			// UTF-8 BOM
			textContent = new TextDecoder('utf-8').decode(arrayBuffer);
			if (textContent.charCodeAt(0) === 0xfeff) {
				textContent = textContent.slice(1);
			}
		} else {
			// Default to UTF-8
			textContent = new TextDecoder('utf-8').decode(arrayBuffer);
		}

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
