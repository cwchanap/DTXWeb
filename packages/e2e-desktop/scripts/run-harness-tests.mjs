import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIRECTORIES = ['support', 'scripts'];

export const discoverHarnessTests = (packageRoot) =>
	TEST_DIRECTORIES.flatMap((directory) =>
		readdirSync(join(packageRoot, directory))
			.filter((name) => name.endsWith('.test.mjs'))
			// Portable forward-slash relative paths: `node:path.join` would emit
			// backslashes on Windows, breaking the spawn args asserted by the
			// harness tests and run by `bun test` in CI. Native join is kept only
			// for real filesystem access above.
			.map((name) => `${directory}/${name}`)
	).sort();

const runTestFile = (spawnProcess, file, packageRoot) =>
	new Promise((resolve) => {
		const child = spawnProcess(process.execPath, ['test', `./${file}`], {
			cwd: packageRoot,
			stdio: 'inherit'
		});
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
	const files = discoverHarnessTests(packageRoot);
	// A gate that passes without running anything would silently stop testing
	// the harness after a rename; fail loudly instead.
	if (files.length === 0) {
		console.error(`No *.test.mjs harness suites found under ${packageRoot}`);
		return 1;
	}
	for (const file of files) {
		const exitCode = await runTestFile(spawnProcess, file, packageRoot);
		if (exitCode !== 0) return exitCode;
	}
	return 0;
};

if (import.meta.main) {
	process.exit(await runHarnessTests(join(import.meta.dirname, '..')));
}
