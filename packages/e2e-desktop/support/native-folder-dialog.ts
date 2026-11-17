import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type NativeFolderDialogAction = 'select' | 'cancel';

// Must exceed the drivers' own worst-case internal waits (~60s on macOS:
// 20s dialog wait + 10s field + 10s dismiss + 10s navigate + 10s close), so
// the script's stage-specific error reaches CI instead of a generic timeout.
export const nativeFolderDialogTimeoutMs = 90_000;

const drivers: Partial<
	Record<NodeJS.Platform, { command: string; prefixArgs: string[]; script: string }>
> = {
	darwin: {
		command: 'osascript',
		prefixArgs: [],
		script: 'native-folder-dialog-macos.applescript'
	},
	win32: {
		command: 'powershell.exe',
		prefixArgs: ['-NoProfile', '-NonInteractive', '-File'],
		script: 'native-folder-dialog-windows.ps1'
	}
};

export const driveDialog = (
	action: NativeFolderDialogAction,
	directory: string,
	signal?: AbortSignal
): Promise<void> => {
	const driver = drivers[process.platform];
	if (!driver) {
		return Promise.reject(
			new Error(`native folder dialog is not supported on platform "${process.platform}"`)
		);
	}
	const script = fileURLToPath(new URL(`../scripts/${driver.script}`, import.meta.url));
	return new Promise((resolvePromise, reject) => {
		execFile(
			driver.command,
			[...driver.prefixArgs, script, action, directory],
			{ timeout: nativeFolderDialogTimeoutMs, signal },
			(error, _stdout, stderr) => {
				if (!error) {
					resolvePromise();
					return;
				}
				const reason = error.killed
					? `timed out after ${nativeFolderDialogTimeoutMs}ms`
					: `failed (code ${error.code ?? error.signal})`;
				const detail = stderr.trim() || error.message;
				reject(new Error(`native folder dialog '${action}' ${reason}: ${detail}`));
			}
		);
	});
};
