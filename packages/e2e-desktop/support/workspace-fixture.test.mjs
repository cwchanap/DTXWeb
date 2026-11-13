import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { canonicalExpectedPath, createWorkspaceFixture, getOrCreatePreseededWorkspaceFixture } =
	await import('./workspace-fixture.ts');

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

// HPA-316 Windows failure: Rust canonicalizes workspace-owned outputs with
// std::fs::canonicalize, which yields verbatim (\\?\-prefixed) long paths, while
// the fixture helper built expectations with the 8.3 short-name temp root
// (C:\Users\RUNNER~1\...). canonicalExpectedPath mirrors that canonicalization.

test('canonicalExpectedPath delegates resolution to realpath before prefixing on win32', () => {
	const resolved = canonicalExpectedPath('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ws', {
		platform: 'win32',
		realpath: () => 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ws'
	});
	expect(resolved).toBe('\\\\?\\C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ws');
});

test('canonicalExpectedPath keeps a single verbatim prefix when realpath already returns one', () => {
	const verbatim = '\\\\?\\C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ws';
	const resolved = canonicalExpectedPath(verbatim, {
		platform: 'win32',
		realpath: (value) => value
	});
	expect(resolved).toBe(verbatim);
});

test('canonicalExpectedPath leaves paths unprefixed off Windows', () => {
	const resolved = canonicalExpectedPath('/private/tmp/ws', {
		platform: 'darwin',
		realpath: (value) => value
	});
	expect(resolved).toBe('/private/tmp/ws');
});

test('created fixture workspaceRoot stays a plain resolved path off Windows', () => {
	const parent = mkdtempSync(join(tmpdir(), 'dtx-e2e-fixture-canonical-'));
	try {
		const fixture = createWorkspaceFixture({ parentPath: parent, includeSong: false });
		expect(fixture.workspaceRoot.startsWith('\\\\?\\')).toBeFalse();
		expect(fixture.workspaceRoot).toBe(realpathSync(join(parent, 'workspace')));
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
