import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
	canonicalExpectedPath,
	createWorkspaceFixture,
	getOrCreatePreseededWorkspaceFixture,
	toNavigableWindowsPath
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

test('canonicalExpectedPath converts a UNC share path to the verbatim UNC namespace on win32', () => {
	// Rust std::fs::canonicalize maps \\server\share\... to \\?\UNC\server\share\...;
	// blindly prepending \\?\ would double the leading separators instead.
	const resolved = canonicalExpectedPath('\\\\server\\share\\workspace', {
		platform: 'win32',
		realpath: (value) => value
	});
	expect(resolved).toBe('\\\\?\\UNC\\server\\share\\workspace');
});

test('canonicalExpectedPath keeps an already verbatim UNC path unchanged', () => {
	const verbatimUnc = '\\\\?\\UNC\\server\\share\\workspace';
	const resolved = canonicalExpectedPath(verbatimUnc, {
		platform: 'win32',
		realpath: (value) => value
	});
	expect(resolved).toBe(verbatimUnc);
});

test('toNavigableWindowsPath rebuilds navigable drive-letter and UNC roots from verbatim forms', () => {
	expect(toNavigableWindowsPath('\\\\?\\C:\\Temp\\ws')).toBe('C:\\Temp\\ws');
	expect(toNavigableWindowsPath('\\\\?\\UNC\\server\\share\\ws')).toBe('\\\\server\\share\\ws');
	expect(toNavigableWindowsPath('C:\\Temp\\ws')).toBe('C:\\Temp\\ws');
});

test('traversal input built from a verbatim UNC workspace root stays anchored at the share', () => {
	// Stripping only \\?\ from a \\?\UNC\... root would leave a relative
	// UNC\... path, so the traversal construction would no longer traverse
	// from inside the workspace.
	const root = canonicalExpectedPath('\\\\server\\share\\workspace', {
		platform: 'win32',
		realpath: (value) => value
	});
	const navigableRoot = toNavigableWindowsPath(root);
	const traversalInput = `${navigableRoot}\\FixtureSong\\..\\..\\outside\\private.dtx`;
	expect(navigableRoot).toBe('\\\\server\\share\\workspace');
	expect(traversalInput.startsWith(navigableRoot)).toBe(true);
});

test('canonicalExpectedPath leaves paths unprefixed off Windows', () => {
	const resolved = canonicalExpectedPath('/private/tmp/ws', {
		platform: 'darwin',
		realpath: (value) => value
	});
	expect(resolved).toBe('/private/tmp/ws');
});

// Platform-aware: the helper deliberately mirrors Rust's std::fs::canonicalize,
// which returns verbatim (\\?\-prefixed) paths on Windows and plain paths
// elsewhere. Asserts the canonical form computed independently of the helper's
// fixture plumbing (native realpath + explicit prefix rule).
test('created fixture workspaceRoot matches the platform canonical form', () => {
	const parent = mkdtempSync(join(tmpdir(), 'dtx-e2e-fixture-canonical-'));
	try {
		const fixture = createWorkspaceFixture({ parentPath: parent, includeSong: false });
		const native =
			typeof realpathSync.native === 'function' ? realpathSync.native : realpathSync;
		const resolved = native(join(parent, 'workspace'));
		const withoutVerbatim = resolved.startsWith('\\\\?\\') ? resolved.slice(4) : resolved;
		if (process.platform === 'win32') {
			expect(fixture.workspaceRoot).toBe(`\\\\?\\${withoutVerbatim}`);
		} else {
			expect(fixture.workspaceRoot).toBe(resolved);
		}
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
