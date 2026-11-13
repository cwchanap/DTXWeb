import { expect, test } from 'bun:test';

const { collectIpcDiagnostics, installIpcDiagnostics } = await import('./app.ts');

const nullCallbackMessage =
	'{"cmd":"plugin:event|listen","callback":null,"error":1,"payload":{},"options":null}';
const numericCallbackMessage =
	'{"cmd":"get_workspace_root","callback":42,"error":43,"payload":null,"options":null}';
const nullErrorMessage =
	'{"cmd":"get_workspace_root","callback":1,"error":null,"payload":null,"options":null}';

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

const fakeWindow = ({ postMessage }) => {
	const calls = [];
	return {
		window: {
			ipc: {
				postMessage: (data) => {
					calls.push(data);
				}
			}
		},
		calls
	};
};

test('installIpcDiagnostics wraps postMessage once and reports already-installed afterwards', () => {
	const { window: targetWindow } = fakeWindow({});
	withPageWindow(targetWindow, () => {
		const outcome = installIpcDiagnostics();
		expect(outcome).toBe('installed');
		expect(installIpcDiagnostics()).toBe('already-installed');
	});
});

test('installIpcDiagnostics reports unavailable when window.ipc.postMessage is missing', () => {
	withPageWindow({}, () => {
		expect(installIpcDiagnostics()).toBe('window-ipc-unavailable');
	});
	withPageWindow({ ipc: {} }, () => {
		expect(installIpcDiagnostics()).toBe('window-ipc-unavailable');
	});
});

test('collectIpcDiagnostics returns an empty array before anything is captured', () => {
	withPageWindow({}, () => {
		expect(collectIpcDiagnostics()).toEqual([]);
	});
});

test('installIpcDiagnostics captures null-callback messages and forwards every message unchanged', () => {
	const { window: targetWindow, calls } = fakeWindow({});
	withPageWindow(targetWindow, () => {
		installIpcDiagnostics();

		targetWindow.ipc.postMessage(nullCallbackMessage);
		targetWindow.ipc.postMessage(numericCallbackMessage);
		targetWindow.ipc.postMessage(nullErrorMessage);

		expect(calls).toEqual([nullCallbackMessage, numericCallbackMessage, nullErrorMessage]);
		expect(collectIpcDiagnostics()).toEqual([nullCallbackMessage, nullErrorMessage]);
	});
});

test('installIpcDiagnostics stringifies non-string payloads before filtering', () => {
	const { window: targetWindow } = fakeWindow({});
	withPageWindow(targetWindow, () => {
		installIpcDiagnostics();

		const payload = JSON.stringify({ cmd: 'plugin:event|listen', callback: null });
		targetWindow.ipc.postMessage(payload);

		expect(collectIpcDiagnostics()).toEqual([payload]);
	});
});

test('installIpcDiagnostics captures the JSON error format with whitespace after the colon', () => {
	const { window: targetWindow } = fakeWindow({});
	withPageWindow(targetWindow, () => {
		installIpcDiagnostics();

		const spaced = '{"cmd":"x","callback" :  null,"error":1}';
		targetWindow.ipc.postMessage(spaced);

		expect(collectIpcDiagnostics()).toEqual([spaced]);
	});
});

test('installIpcDiagnostics caps the capture buffer at 20 entries', () => {
	const { window: targetWindow } = fakeWindow({});
	withPageWindow(targetWindow, () => {
		installIpcDiagnostics();

		for (let index = 0; index < 25; index += 1) {
			targetWindow.ipc.postMessage(`{"cmd":"c${index}","callback":null}`);
		}

		const captured = collectIpcDiagnostics();
		expect(captured).toHaveLength(20);
		expect(captured[0]).toContain('"c0"');
		expect(captured[19]).toContain('"c19"');
	});
});

test('installIpcDiagnostics reports wrap-rejected when postMessage is not writable', () => {
	const targetWindow = {
		ipc: {}
	};
	Object.defineProperty(targetWindow.ipc, 'postMessage', {
		value: () => {},
		writable: false,
		configurable: false
	});

	withPageWindow(targetWindow, () => {
		expect(installIpcDiagnostics()).toBe('wrap-rejected');
	});
});
