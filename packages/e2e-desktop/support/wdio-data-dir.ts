import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type WdioDataDirectory = {
	path: string;
	owned: boolean;
};

export const allocateWdioDataDirectory = (
	externalDataDirectory = process.env.DTX_E2E_DATA_DIR
): WdioDataDirectory => {
	if (externalDataDirectory) {
		return { path: externalDataDirectory, owned: false };
	}

	return {
		path: mkdtempSync(join(tmpdir(), 'dtx-e2e-data-')),
		owned: true
	};
};

export const cleanupWdioDataDirectory = (allocation: WdioDataDirectory): void => {
	if (!allocation.owned) return;

	try {
		rmSync(allocation.path, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200
		});
	} catch {
		// CI runners are ephemeral; a local abandoned run-owned directory is harmless.
	}
};
