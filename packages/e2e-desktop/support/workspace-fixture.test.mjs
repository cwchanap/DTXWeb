import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
	canonicalExpectedPath,
	createWorkspaceFixture,
	getOrCreatePreseededWorkspaceFixture,
	getPreseededWorkspaceFixture
} = await import('./workspace-fixture.ts');

const fixtureEnvironmentKeys = [
	'DTX_E2E_WORKSPACE_ROOT',
	'DTX_E2E_OUTSIDE_ROOT',
	'DTX_E2E_ESCAPE_LINK_PATH',
	'DTX_E2E_ESCAPE_LINK_UNAVAILABLE_REASON'
];

test('reuses coordinator fixture paths when a WDIO worker inherits the environment', () => {
	const previousEnvironment = new Map(
		fixtureEnvironmentKeys.map((key) => [key, process.env[key]])
	);
	const coordinatorParent = mkdtempSync(join(tmpdir(), 'dtx-e2e-fixture-coordinator-'));
	const workerParent = mkdtempSync(join(tmpdir(), 'dtx-e2e-fixture-worker-'));

	try {
		for (const key of fixtureEnvironmentKeys) delete process.env[key];

		const coordinatorFixture = getOrCreatePreseededWorkspaceFixture({
			parentPath: coordinatorParent
		});
		const workerFixture = getOrCreatePreseededWorkspaceFixture({ parentPath: workerParent });

		expect(workerFixture).toEqual(coordinatorFixture);
		expect(existsSync(join(workerParent, 'workspace'))).toBeFalse();
	} finally {
		for (const key of fixtureEnvironmentKeys) {
			const previousValue = previousEnvironment.get(key);
			if (previousValue === undefined) delete process.env[key];
			else process.env[key] = previousValue;
		}
		rmSync(coordinatorParent, { recursive: true, force: true });
		rmSync(workerParent, { recursive: true, force: true });
	}
});

// Rust strips Windows verbatim (`\\?\`) prefixes before returning canonical
// paths over IPC, while still expanding 8.3 short names (`C:\Users\RUNNER~1\...`)
// and symlinks. canonicalExpectedPath delegates to native realpath without
// adding a verbatim prefix.

test('canonicalExpectedPath delegates resolution to realpath without adding a verbatim prefix', () => {
	const resolved = canonicalExpectedPath('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ws', {
		realpath: () => 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ws'
	});
	expect(resolved).toBe('C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ws');
});

test('getPreseededWorkspaceFixture does not throw ENOENT when DTX_E2E_WORKSPACE_ROOT is missing', () => {
	const previousEnvironment = new Map(
		fixtureEnvironmentKeys.map((key) => [key, process.env[key]])
	);
	const missingRoot = join(tmpdir(), `dtx-e2e-missing-ws-${Date.now()}`);
	const missingOutside = join(tmpdir(), `dtx-e2e-missing-out-${Date.now()}`);

	try {
		process.env.DTX_E2E_WORKSPACE_ROOT = missingRoot;
		process.env.DTX_E2E_OUTSIDE_ROOT = missingOutside;
		delete process.env.DTX_E2E_ESCAPE_LINK_PATH;
		delete process.env.DTX_E2E_ESCAPE_LINK_UNAVAILABLE_REASON;

		const fixture = getPreseededWorkspaceFixture();
		expect(fixture.workspaceRoot).toBe(missingRoot);
		expect(fixture.outsideRoot).toBe(missingOutside);
		expect(fixture.songFolder).toBe(join(missingRoot, 'FixtureSong'));
	} finally {
		for (const key of fixtureEnvironmentKeys) {
			const previousValue = previousEnvironment.get(key);
			if (previousValue === undefined) delete process.env[key];
			else process.env[key] = previousValue;
		}
	}
});

test('created fixture workspaceRoot, outsideRoot, and escapeLinkPath share the native canonical parent', () => {
	const parent = mkdtempSync(join(tmpdir(), 'dtx-e2e-fixture-canonical-'));
	try {
		const fixture = createWorkspaceFixture({ parentPath: parent, includeSong: false });
		const resolvedParent = realpathSync.native(parent);
		expect(fixture.workspaceRoot).toBe(join(resolvedParent, 'workspace'));
		expect(fixture.outsideRoot).toBe(join(resolvedParent, 'outside'));
		if (fixture.escapeLinkPath !== null) {
			expect(fixture.escapeLinkPath).toBe(join(fixture.workspaceRoot, 'outside-link'));
		}
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
