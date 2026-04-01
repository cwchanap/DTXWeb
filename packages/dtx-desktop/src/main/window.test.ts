import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture mock instances so event handlers can be inspected
let mockWebContents: ReturnType<typeof createMockWebContents>;
let mockMainWindow: ReturnType<typeof createMockWindow>;

const createMockWebContents = () => ({
	setWindowOpenHandler: vi.fn(),
	on: vi.fn(),
	isDevToolsOpened: vi.fn().mockReturnValue(false),
	closeDevTools: vi.fn(),
	openDevTools: vi.fn()
});

const createMockWindow = () => ({
	on: vi.fn(),
	webContents: mockWebContents,
	show: vi.fn(),
	loadURL: vi.fn(),
	loadFile: vi.fn()
});

vi.mock('electron', () => ({
	BrowserWindow: vi.fn().mockImplementation(() => mockMainWindow),
	shell: {
		openExternal: vi.fn()
	},
	app: {
		isPackaged: false
	}
}));

vi.mock('path', async (importOriginal) => {
	const actual = await importOriginal<typeof import('path')>();
	return {
		...actual,
		join: vi.fn((...args: string[]) => args.join('/'))
	};
});

import { BrowserWindow, shell, app } from 'electron';

describe('createWindow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWebContents = createMockWebContents();
		mockMainWindow = createMockWindow();
		vi.mocked(BrowserWindow).mockImplementation(
			() => mockMainWindow as unknown as BrowserWindow
		);
		delete process.env['ELECTRON_RENDERER_URL'];
	});

	const importCreateWindow = async () => {
		const { createWindow } = await import('./window');
		return createWindow;
	};

	it('creates a BrowserWindow with correct default options', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		expect(BrowserWindow).toHaveBeenCalledWith(
			expect.objectContaining({
				width: 900,
				height: 670,
				show: false,
				autoHideMenuBar: true,
				webPreferences: expect.objectContaining({
					sandbox: false,
					devTools: true
				})
			})
		);
	});

	it('shows the window when ready-to-show fires', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		// Find the 'ready-to-show' handler and invoke it
		const onCall = mockMainWindow.on.mock.calls.find(([event]) => event === 'ready-to-show');
		expect(onCall).toBeDefined();
		onCall![1]();

		expect(mockMainWindow.show).toHaveBeenCalled();
	});

	it('setWindowOpenHandler denies popup and opens externally', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		const handlerArg = mockWebContents.setWindowOpenHandler.mock.calls[0][0];
		const result = handlerArg({ url: 'https://example.com' });

		expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
		expect(result).toEqual({ action: 'deny' });
	});

	it('F12 opens devtools when they are closed', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		vi.mocked(mockWebContents.isDevToolsOpened).mockReturnValue(false);

		const onCall = mockWebContents.on.mock.calls.find(
			([event]) => event === 'before-input-event'
		);
		expect(onCall).toBeDefined();
		onCall![1]({}, { key: 'F12', control: false, meta: false, shift: false });

		expect(mockWebContents.openDevTools).toHaveBeenCalled();
		expect(mockWebContents.closeDevTools).not.toHaveBeenCalled();
	});

	it('F12 closes devtools when they are open', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		vi.mocked(mockWebContents.isDevToolsOpened).mockReturnValue(true);

		const onCall = mockWebContents.on.mock.calls.find(
			([event]) => event === 'before-input-event'
		);
		onCall![1]({}, { key: 'F12', control: false, meta: false, shift: false });

		expect(mockWebContents.closeDevTools).toHaveBeenCalled();
		expect(mockWebContents.openDevTools).not.toHaveBeenCalled();
	});

	it('Ctrl+Shift+I opens devtools when they are closed', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		vi.mocked(mockWebContents.isDevToolsOpened).mockReturnValue(false);

		const onCall = mockWebContents.on.mock.calls.find(
			([event]) => event === 'before-input-event'
		);
		onCall![1]({}, { key: 'I', control: true, meta: false, shift: true });

		expect(mockWebContents.openDevTools).toHaveBeenCalled();
	});

	it('Ctrl+Shift+I closes devtools when they are open', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		vi.mocked(mockWebContents.isDevToolsOpened).mockReturnValue(true);

		const onCall = mockWebContents.on.mock.calls.find(
			([event]) => event === 'before-input-event'
		);
		onCall![1]({}, { key: 'i', control: true, meta: false, shift: true });

		expect(mockWebContents.closeDevTools).toHaveBeenCalled();
	});

	it('Cmd+Shift+I (meta) toggles devtools', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		vi.mocked(mockWebContents.isDevToolsOpened).mockReturnValue(false);

		const onCall = mockWebContents.on.mock.calls.find(
			([event]) => event === 'before-input-event'
		);
		onCall![1]({}, { key: 'i', control: false, meta: true, shift: true });

		expect(mockWebContents.openDevTools).toHaveBeenCalled();
	});

	it('unrelated key does not toggle devtools', async () => {
		const { createWindow } = await import('./window');
		createWindow();

		const onCall = mockWebContents.on.mock.calls.find(
			([event]) => event === 'before-input-event'
		);
		onCall![1]({}, { key: 'A', control: false, meta: false, shift: false });

		expect(mockWebContents.openDevTools).not.toHaveBeenCalled();
		expect(mockWebContents.closeDevTools).not.toHaveBeenCalled();
	});

	it('loads URL in dev mode when ELECTRON_RENDERER_URL is set', async () => {
		process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';
		vi.mocked(app as { isPackaged: boolean }).isPackaged = false;

		const { createWindow } = await import('./window');
		createWindow();

		expect(mockMainWindow.loadURL).toHaveBeenCalledWith('http://localhost:5173');
		expect(mockMainWindow.loadFile).not.toHaveBeenCalled();
	});

	it('loads file in production mode', async () => {
		vi.mocked(app as { isPackaged: boolean }).isPackaged = true;

		const { createWindow } = await import('./window');
		createWindow();

		expect(mockMainWindow.loadFile).toHaveBeenCalled();
		expect(mockMainWindow.loadURL).not.toHaveBeenCalled();

		vi.mocked(app as { isPackaged: boolean }).isPackaged = false;
	});

	it('loads file when not in dev mode (no ELECTRON_RENDERER_URL)', async () => {
		vi.mocked(app as { isPackaged: boolean }).isPackaged = false;
		delete process.env['ELECTRON_RENDERER_URL'];

		const { createWindow } = await import('./window');
		createWindow();

		expect(mockMainWindow.loadFile).toHaveBeenCalled();
		expect(mockMainWindow.loadURL).not.toHaveBeenCalled();
	});
});
