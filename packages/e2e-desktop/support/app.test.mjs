import { expect, test } from 'bun:test';

const { collectIpcDiagnostics, dumpIpcDiagnosticsSafely, installIpcDiagnostics } =
	await import('./app.ts');

// Mirrors wry 0.57.0 exactly, on both WebView2 and WKWebView:
//   Object.defineProperty(window, 'ipc', { value: Object.freeze({ postMessage: ... }) })
// (src/webview2/mod.rs:952 and src/wkwebview/mod.rs:642). The property and the
// object are both locked: postMessage cannot be wrapped in page code.
const wryStyleWindow = () => {
	const sent = [];
	const targetWindow = {
		fetch: async (input, init) => {
			return { status: 200, url: String(input) };
		},
		__TAURI_INTERNALS__: { callbacks: { size: 3 } }
	};
	Object.defineProperty(targetWindow, 'ipc', {
		value: Object.freeze({
			postMessage: (data) => {
				sent.push(data);
			}
		})
	});
	return { targetWindow, sent };
};

const withPageWindow = (targetWindow, run) => {
	const previousWindow = globalThis.window;
	globalThis.window = targetWindow;
	try {
		run();
	} finally {
		if (previousWindow === undefined) delete globalThis.window;
		else globalThis.window = previousWindow;
	}
};

const withPageWindowAsync = async (targetWindow, run) => {
	const previousWindow = globalThis.window;
	globalThis.window = targetWindow;
	try {
		await run();
	} finally {
		if (previousWindow === undefined) delete globalThis.window;
		else globalThis.window = previousWindow;
	}
};

const captureConsoleInfo = async (run) => {
	const lines = [];
	const originalInfo = console.info;
	console.info = (...args) => {
		lines.push(args.map((argument) => String(argument)).join(' '));
	};
	try {
		await run();
	} finally {
		console.info = originalInfo;
	}
	return lines;
};

test('installIpcDiagnostics installs on the real wry frozen ipc shape without touching it', () => {
	const { targetWindow, sent } = wryStyleWindow();
	withPageWindow(targetWindow, () => {
		const originalPostMessage = targetWindow.ipc.postMessage;
		const originalFetch = targetWindow.fetch;
		const outcome = installIpcDiagnostics();

		expect(outcome).toBe('installed');
		// The frozen wry channel is left byte-for-byte intact: same descriptor,
		// same function identity, still able to deliver.
		const descriptor = Object.getOwnPropertyDescriptor(targetWindow, 'ipc');
		expect(descriptor.writable).toBeFalse();
		expect(descriptor.configurable).toBeFalse();
		expect(Object.isFrozen(descriptor.value)).toBeTrue();
		expect(targetWindow.ipc.postMessage).toBe(originalPostMessage);
		targetWindow.ipc.postMessage('ping');
		expect(sent).toEqual(['ping']);
		// Observation went through the writable seam instead.
		expect(targetWindow.fetch).not.toBe(originalFetch);
	});
});

test('installIpcDiagnostics reports already-installed and wraps fetch only once', () => {
	const { targetWindow } = wryStyleWindow();
	withPageWindow(targetWindow, () => {
		expect(installIpcDiagnostics()).toBe('installed');
		const wrappedFetch = targetWindow.fetch;
		expect(installIpcDiagnostics()).toBe('already-installed');
		expect(targetWindow.fetch).toBe(wrappedFetch);
	});
});

test('installIpcDiagnostics reports unavailable when Tauri internals are missing', () => {
	withPageWindow({ fetch: async () => ({ status: 200 }) }, () => {
		expect(installIpcDiagnostics()).toBe('tauri-internals-unavailable');
	});
	withPageWindow({ fetch: async () => ({ status: 200 }), __TAURI_INTERNALS__: {} }, () => {
		expect(installIpcDiagnostics()).toBe('tauri-internals-unavailable');
	});
});

test('installIpcDiagnostics reports unavailable when window.fetch is missing', () => {
	withPageWindow({ __TAURI_INTERNALS__: { callbacks: { size: 0 } } }, () => {
		expect(installIpcDiagnostics()).toBe('fetch-unavailable');
	});
});

test('collectIpcDiagnostics returns null before anything is installed', () => {
	withPageWindow({}, () => {
		expect(collectIpcDiagnostics()).toBeNull();
	});
});

test('fetch wrapper records IPC sends by command name and forwards them unchanged', async () => {
	const { targetWindow } = wryStyleWindow();
	const forwarded = [];
	targetWindow.fetch = async (input, init) => {
		forwarded.push({ input, init });
		return { status: 200 };
	};
	await withPageWindowAsync(targetWindow, async () => {
		installIpcDiagnostics();
		await targetWindow.fetch('http://ipc.localhost/get_google_drive_connection_state', {
			method: 'POST',
			headers: { 'Tauri-Callback': '7' }
		});

		expect(forwarded).toHaveLength(1);
		expect(forwarded[0].input).toBe('http://ipc.localhost/get_google_drive_connection_state');
		expect(forwarded[0].init).toEqual({ method: 'POST', headers: { 'Tauri-Callback': '7' } });
		expect(collectIpcDiagnostics().fetchTransport).toEqual([
			'fetch cmd=get_google_drive_connection_state status=200'
		]);
	});
});

test('fetch wrapper records the ipc:// scheme used on non-Windows platforms', async () => {
	const { targetWindow } = wryStyleWindow();
	await withPageWindowAsync(targetWindow, async () => {
		installIpcDiagnostics();
		await targetWindow.fetch('ipc://localhost/get_workspace_root');
		expect(collectIpcDiagnostics().fetchTransport).toEqual([
			'fetch cmd=get_workspace_root status=200'
		]);
	});
});

test('fetch wrapper never records non-IPC traffic or its contents', async () => {
	const { targetWindow } = wryStyleWindow();
	await withPageWindowAsync(targetWindow, async () => {
		installIpcDiagnostics();
		await targetWindow.fetch('https://api.example.test/graphql?token=API-SECRET');
		await targetWindow.fetch('http://ipc.localhost/get_current_session', {
			headers: { Authorization: 'Bearer HEADER-SECRET' }
		});

		const report = collectIpcDiagnostics();
		expect(report.fetchTransport).toEqual(['fetch cmd=get_current_session status=200']);
		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain('API-SECRET');
		expect(serialized).not.toContain('HEADER-SECRET');
		expect(serialized).not.toContain('Bearer');
	});
});

test('fetch wrapper records a failed IPC send without the error text and preserves the rejection', async () => {
	const { targetWindow } = wryStyleWindow();
	targetWindow.fetch = async () => {
		throw new Error('network failure DETAIL-SECRET');
	};
	await withPageWindowAsync(targetWindow, async () => {
		installIpcDiagnostics();

		let rejection;
		try {
			await targetWindow.fetch('http://ipc.localhost/get_workspace_root');
		} catch (error) {
			rejection = error;
		}
		expect(rejection?.message).toBe('network failure DETAIL-SECRET');
		expect(collectIpcDiagnostics().fetchTransport).toEqual([
			'fetch cmd=get_workspace_root failed'
		]);
	});
});

test('fetch wrapper strips query strings and records the command name only', async () => {
	const { targetWindow } = wryStyleWindow();
	await withPageWindowAsync(targetWindow, async () => {
		installIpcDiagnostics();
		await targetWindow.fetch('http://ipc.localhost/get_workspace_root?token=QUERY-SECRET');

		const serialized = JSON.stringify(collectIpcDiagnostics());
		expect(serialized).toContain('fetch cmd=get_workspace_root status=200');
		expect(serialized).not.toContain('QUERY-SECRET');
	});
});

test('collectIpcDiagnostics reports the frozen ipc transport honestly and callback growth', async () => {
	const { targetWindow } = wryStyleWindow();
	withPageWindow(targetWindow, () => {
		installIpcDiagnostics();
		targetWindow.__TAURI_INTERNALS__.callbacks.size = 9;

		const report = collectIpcDiagnostics();
		expect(report.ipc).toEqual({ present: true, postMessageWritable: false });
		expect(report.callbacks).toEqual({ atInstall: 3, now: 9 });
	});
});

test('fetch wrapper caps recorded summaries at 20 entries', async () => {
	const { targetWindow } = wryStyleWindow();
	await withPageWindowAsync(targetWindow, async () => {
		installIpcDiagnostics();
		const sends = [];
		for (let index = 0; index < 25; index += 1) {
			sends.push(targetWindow.fetch(`http://ipc.localhost/cmd_${index}`));
		}
		await Promise.all(sends);

		const captured = collectIpcDiagnostics().fetchTransport;
		expect(captured).toHaveLength(20);
		expect(captured[0]).toContain('cmd_0');
		expect(captured[19]).toContain('cmd_19');
	});
});

test('dumpIpcDiagnosticsSafely logs the sanitized report', async () => {
	const lines = await captureConsoleInfo(async () => {
		await dumpIpcDiagnosticsSafely(async () => ({
			ipc: { present: true, postMessageWritable: false },
			fetchTransport: ['fetch cmd=get_workspace_root status=200'],
			callbacks: { atInstall: 1, now: 2 }
		}));
	});
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain('fetch cmd=get_workspace_root status=200');
});

test('dumpIpcDiagnosticsSafely logs a fixed marker without exception content on failure', async () => {
	const lines = await captureConsoleInfo(async () => {
		await dumpIpcDiagnosticsSafely(async () => {
			throw new Error('WebDriver session SESS-SECRET-TOKEN aborted for secret@example.com');
		});
	});
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain('ipc diagnostics dump failed');
	expect(lines.join(' ')).not.toContain('SESS-SECRET-TOKEN');
	expect(lines.join(' ')).not.toContain('secret@example.com');
	expect(lines.join(' ')).not.toContain('WebDriver');
});
