import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverHarnessTests, runHarnessTests } from './run-harness-tests.mjs';

const makeSandbox = (files) => {
	const root = mkdtempSync(join(tmpdir(), 'dtx-harness-runner-'));
	for (const [relativePath, content] of Object.entries(files)) {
		mkdirSync(join(root, relativePath, '..'), { recursive: true });
		writeFileSync(join(root, relativePath), content);
	}
	return root;
};

const exitChild = (exitCode) => ({
	once: (event, handler) => {
		if (event === 'exit') handler(exitCode);
	}
});

const errorChild = () => ({
	once: (event, handler) => {
		if (event === 'error') handler(new Error('spawn ENOENT'));
	}
});

test('discovers support and scripts suites in sorted order', () => {
	const root = makeSandbox({
		'support/zeta.test.mjs': '',
		'support/alpha.test.mjs': '',
		'support/helper.mjs': '',
		'scripts/mid.test.mjs': '',
		'scripts/ignored.ts': ''
	});
	try {
		expect(discoverHarnessTests(root)).toEqual([
			'scripts/mid.test.mjs',
			'support/alpha.test.mjs',
			'support/zeta.test.mjs'
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('spawns one inherited-stdio test process per suite in the package root and succeeds when all pass', async () => {
	const root = makeSandbox({ 'support/a.test.mjs': '', 'scripts/b.test.mjs': '' });
	const spawned = [];
	const spawn = (command, args, options) => {
		spawned.push({ args, command, options });
		return exitChild(0);
	};
	try {
		await expect(runHarnessTests(root, { spawn })).resolves.toBe(0);
		expect(spawned).toEqual([
			{
				command: process.execPath,
				args: ['test', './scripts/b.test.mjs'],
				options: { stdio: 'inherit', cwd: root }
			},
			{
				command: process.execPath,
				args: ['test', './support/a.test.mjs'],
				options: { stdio: 'inherit', cwd: root }
			}
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('fails the gate when no harness suites are discovered', async () => {
	const root = makeSandbox({ 'support/helper.mjs': '', 'scripts/README.md': '' });
	let spawned = 0;
	const spawn = () => {
		spawned += 1;
		return exitChild(0);
	};
	try {
		await expect(runHarnessTests(root, { spawn })).resolves.toBe(1);
		expect(spawned).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('stops at the first failing suite and propagates its exit code', async () => {
	const root = makeSandbox({
		'scripts/a-failing.test.mjs': '',
		'support/b-after.test.mjs': ''
	});
	const spawnedFiles = [];
	const spawn = (_command, args) => {
		spawnedFiles.push(args[1]);
		return exitChild(args[1].includes('failing') ? 3 : 0);
	};
	try {
		await expect(runHarnessTests(root, { spawn })).resolves.toBe(3);
		expect(spawnedFiles).toEqual(['./scripts/a-failing.test.mjs']);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('stops with a failure when a suite process fails to spawn', async () => {
	const root = makeSandbox({
		'scripts/a-boom.test.mjs': '',
		'support/b-never.test.mjs': ''
	});
	const spawnedFiles = [];
	const spawn = (_command, args) => {
		spawnedFiles.push(args[1]);
		return errorChild();
	};
	try {
		await expect(runHarnessTests(root, { spawn })).resolves.toBe(1);
		expect(spawnedFiles).toEqual(['./scripts/a-boom.test.mjs']);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
