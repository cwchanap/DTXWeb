import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { decodeArrayBufferWithBomDetection, parseSetDef } from '@dtx/common';
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

export const load: PageServerLoad = async ({ params, fetch }) => {
	const { simfileID } = params;

	// If no simfileID, return empty metadata (local file mode)
	if (!simfileID) {
		return {
			simfileID: null,
			metadata: null
		};
	}

	const apiBase = (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');

	// Local dev — defer to client-side fetching.
	if (dev) {
		return {
			simfileID,
			metadata: null
		};
	}

	// Production without API URL configured — misconfiguration, fail loudly.
	if (!apiBase) {
		throw error(500, 'DTX API URL not configured');
	}

	try {
		// Fetch set.def from dtx-api (public passthrough to R2)
		const res = await fetch(`${apiBase}/simfiles/${simfileID}/set.def`);
		if (res.status === 404) {
			throw error(404, `SimFile ${simfileID} not found`);
		}
		if (!res.ok) {
			throw error(res.status, `Failed to load simfile metadata: ${res.status}`);
		}

		const arrayBuffer = await res.arrayBuffer();
		const textContent = decodeArrayBufferWithBomDetection(arrayBuffer);

		// Parse the def file content with the shared parser (space/colon
		// directives, case-insensitive keys, slots beyond L5).
		const parsed = parseSetDef(textContent);
		const metadata: SimFileMetadata = {
			title: parsed.title,
			levels: Object.fromEntries(
				parsed.levels.map(({ level, label, fileName }) => [level, { label, fileName }])
			)
		};

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
