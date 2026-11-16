import { test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const script of [
	'temporary-macos-ax-diagnostic.applescript',
	'native-folder-dialog-macos.applescript'
]) {
	test.skipIf(process.platform !== 'darwin')(
		`TEMPORARY compile ${script}`,
		() => {
			const directory = mkdtempSync(join(tmpdir(), 'dtx-applescript-compile-'));
			try {
				execFileSync(
					'osacompile',
					[
						'-o',
						join(directory, 'compiled.scpt'),
						fileURLToPath(new URL(script, import.meta.url))
					],
					{ stdio: 'inherit', timeout: 20_000, killSignal: 'SIGKILL' }
				);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		30_000
	);
}
