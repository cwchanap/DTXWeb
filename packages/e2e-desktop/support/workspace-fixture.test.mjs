import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { getOrCreatePreseededWorkspaceFixture } = await import('./workspace-fixture.ts');

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
