import { spawn } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
	new Promise((resolvePromise) => {
		const child = spawnProcess(process.execPath, ['test', `./${file}`], {
			cwd: packageRoot,
			stdio: 'inherit'
		});
		let settled = false;
		const settle = (exitCode) => {
			if (settled) return;
			settled = true;
			resolvePromise(exitCode);
		};
		child.once('exit', (code) => settle(code ?? 1));
		child.once('error', () => settle(1));
	});

export const runHarnessTests = async (
	packageRoot,
	{ spawn: spawnProcess = spawn, versions = process.versions } = {}
) => {
	if (!versions?.bun) {
		console.error('run-harness-tests.mjs must be executed with Bun');
		return 1;
	}
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

const isDirectExecution = () => {
	if (import.meta.main) return true;
	const entryArg = process.argv[1];
	if (!entryArg) return false;
	try {
		return realpathSync(resolve(entryArg)) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
};

if (isDirectExecution()) {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	process.exit(await runHarnessTests(join(scriptDir, '..')));
}
