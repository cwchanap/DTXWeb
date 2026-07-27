import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { allocateWdioDataDirectory, cleanupWdioDataDirectory } = await import('./wdio-data-dir.ts');

test('cleans a data directory created for the current WDIO run', () => {
	const previousDataDir = process.env.DTX_E2E_DATA_DIR;
	delete process.env.DTX_E2E_DATA_DIR;
	try {
		const allocation = allocateWdioDataDirectory();
		writeFileSync(join(allocation.path, 'owned-sentinel.txt'), 'owned');

		cleanupWdioDataDirectory(allocation);

		expect(allocation.owned).toBeTrue();
		expect(existsSync(allocation.path)).toBeFalse();
	} finally {
		if (previousDataDir === undefined) delete process.env.DTX_E2E_DATA_DIR;
		else process.env.DTX_E2E_DATA_DIR = previousDataDir;
	}
});

test('preserves an externally supplied data directory and unrelated sentinel files', () => {
	const callerDirectory = mkdtempSync(join(tmpdir(), 'dtx-e2e-caller-data-'));
	const callerSentinel = join(callerDirectory, 'caller-sentinel.txt');
	writeFileSync(callerSentinel, 'caller-owned');
	mkdirSync(join(callerDirectory, 'dtxweb'));

	try {
		const allocation = allocateWdioDataDirectory(callerDirectory);
		writeFileSync(join(allocation.path, 'dtxweb', 'run-output.txt'), 'run');

		cleanupWdioDataDirectory(allocation);

		expect(allocation).toEqual({ path: callerDirectory, owned: false });
		expect(existsSync(callerDirectory)).toBeTrue();
		expect(existsSync(callerSentinel)).toBeTrue();
	} finally {
		rmSync(callerDirectory, { recursive: true, force: true });
	}
});
