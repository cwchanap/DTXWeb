import { expect, test } from 'bun:test';
import { _setGlobal } from '@wdio/globals';

const { probeGoogleDriveConnectionDiagnostics } = await import('./native.ts');

// The probe runs as a serialized page callback via browser.tauri.execute; the
// fake browser invokes the real page function in-process with a fake core.
const useFakeBrowser = (core) => {
	_setGlobal('browser', {
		tauri: {
			execute: async (pageFunction) => pageFunction({ core })
		}
	});
};

test('probe reports session existence and connection connected only, never raw values', async () => {
	useFakeBrowser({
		invoke: async (command) => {
			if (command === 'get_current_session') {
				return {
					userId: 'user-1',
					sessionToken: 'SESSION-SECRET',
					email: 'secret@example.com'
				};
			}
			return { connected: true, accessToken: 'DRIVE-SECRET', email: 'drive@example.com' };
		}
	});

	const result = await probeGoogleDriveConnectionDiagnostics();

	expect(result.session).toEqual({ ok: true, exists: true });
	expect(result.connection).toEqual({ ok: true, connected: true });
	const serialized = JSON.stringify(result);
	expect(serialized).not.toContain('SESSION-SECRET');
	expect(serialized).not.toContain('DRIVE-SECRET');
	expect(serialized).not.toContain('user-1');
});

test('probe reports false booleans for a null session and a disconnected connection', async () => {
	useFakeBrowser({
		invoke: async (command) => (command === 'get_current_session' ? null : { connected: false })
	});

	const result = await probeGoogleDriveConnectionDiagnostics();

	expect(result.session).toEqual({ ok: true, exists: false });
	expect(result.connection).toEqual({ ok: true, connected: false });
});

test('probe reports a generic failure without the error text', async () => {
	useFakeBrowser({
		invoke: async () => {
			throw new Error('rejection details with ERROR-SECRET payload');
		}
	});

	const result = await probeGoogleDriveConnectionDiagnostics();

	expect(result.session).toEqual({ ok: false });
	expect(result.connection).toEqual({ ok: false });
	expect(JSON.stringify(result)).not.toContain('ERROR-SECRET');
});

test('probe reports a generic timeout when an invoke hangs', async () => {
	useFakeBrowser({
		invoke: () => new Promise(() => {})
	});

	const result = await probeGoogleDriveConnectionDiagnostics();

	expect(result.session).toEqual({ ok: false, timedOut: true });
	expect(result.connection).toEqual({ ok: false, timedOut: true });
}, 15_000);
