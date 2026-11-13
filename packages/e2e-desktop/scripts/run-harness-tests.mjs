import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIRECTORIES = ['support', 'scripts'];

export const discoverHarnessTests = (packageRoot) =>
	TEST_DIRECTORIES.flatMap((directory) =>
		readdirSync(join(packageRoot, directory))
			.filter((name) => name.endsWith('.test.mjs'))
			.map((name) => join(directory, name))
	).sort();

const runTestFile = (spawnProcess, file) =>
	new Promise((resolve) => {
		const child = spawnProcess(process.execPath, ['test', `./${file}`], { stdio: 'inherit' });
		let settled = false;
		const settle = (exitCode) => {
			if (settled) return;
			settled = true;
			resolve(exitCode);
		};
		child.once('exit', (code) => settle(code ?? 1));
		child.once('error', () => settle(1));
	});

export const runHarnessTests = async (packageRoot, { spawn: spawnProcess = spawn } = {}) => {
	for (const file of discoverHarnessTests(packageRoot)) {
		const exitCode = await runTestFile(spawnProcess, file);
		if (exitCode !== 0) return exitCode;
	}
	return 0;
};

if (import.meta.main) {
	process.exit(await runHarnessTests(join(import.meta.dirname, '..')));
}
