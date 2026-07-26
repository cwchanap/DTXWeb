import { cleanupWdioSession, createTauriCapabilities, startWdioSession } from '@wdio/tauri-service';

type StandaloneTauriSessionInput = {
	appBinaryPath: string;
	dataDir: string;
	logDir: string;
};

const isExpectedDisconnect = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error);
	return /ECONNREFUSED|connection refused|socket hang up|invalid session id|disconnected/i.test(
		message
	);
};

export const startStandaloneTauriSession = async ({
	appBinaryPath,
	dataDir,
	logDir
}: StandaloneTauriSessionInput): Promise<WebdriverIO.Browser> => {
	const capabilities = createTauriCapabilities(appBinaryPath, {
		driverProvider: 'embedded',
		startTimeout: 60_000
	});
	capabilities['wdio:tauriServiceOptions'] = {
		...capabilities['wdio:tauriServiceOptions'],
		captureBackendLogs: true,
		captureFrontendLogs: true,
		logDir
	};

	return await startWdioSession(capabilities, {
		env: { DTX_E2E_DATA_DIR: dataDir }
	});
};

export const terminateStandaloneTauriSession = async (
	browser: WebdriverIO.Browser,
	code?: number
): Promise<void> => {
	try {
		await browser.tauri.execute<void, [number | undefined]>(
			({ core }, exitCode) =>
				core.invoke('plugin:process|exit', { code: exitCode }) as Promise<void>,
			code
		);
	} catch (error) {
		if (!isExpectedDisconnect(error)) {
			throw error;
		}
	} finally {
		await cleanupWdioSession(browser).catch(() => undefined);
	}
};
