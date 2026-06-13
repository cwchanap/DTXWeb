import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { desktopHost, setDesktopHostRuntimeForTests, type DesktopHostRuntime } from './desktopHost';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn()
}));

const makeRuntime = (kind: DesktopHostRuntime['kind'] = 'tauri'): DesktopHostRuntime => ({
	kind,
	invoke: vi.fn(),
	send: vi.fn(),
	listen: vi.fn(),
	removeAllListeners: vi.fn(),
	getPlatform: vi.fn(() => 'darwin'),
	getEnvironment: vi.fn(() => ({ HOME: '/Users/Test' })),
	getVersions: vi.fn(() => ({ app: '1.0.0', tauri: null, electron: '35.0.0' }))
});

describe('desktopHost', () => {
	let runtime: DesktopHostRuntime;

	beforeEach(() => {
		runtime = makeRuntime();
		setDesktopHostRuntimeForTests(runtime);
	});

	afterEach(() => {
		setDesktopHostRuntimeForTests(null);
		vi.restoreAllMocks();
		delete window.__TAURI__;
	});

	it('maps selectFolder to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ canceled: false, filePaths: ['/songs'] });

		await expect(desktopHost.selectFolder()).resolves.toEqual({
			canceled: false,
			filePaths: ['/songs']
		});
		expect(runtime.invoke).toHaveBeenCalledWith('select_folder');
	});

	it('maps selectFolder to the Electron channel while Electron is the runtime', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		vi.mocked(runtime.invoke).mockResolvedValue({ canceled: true, filePaths: [] });

		await expect(desktopHost.selectFolder()).resolves.toEqual({
			canceled: true,
			filePaths: []
		});

		expect(runtime.invoke).toHaveBeenCalledWith('select-folder');
	});

	it('maps checkForUpdate to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ success: true, updateInfo: null });

		await expect(desktopHost.checkForUpdate()).resolves.toEqual({
			success: true,
			updateInfo: null
		});

		expect(runtime.invoke).toHaveBeenCalledWith('check_for_update');
	});

	it('maps checkForUpdate to the Electron channel while Electron is the runtime', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		vi.mocked(runtime.invoke).mockResolvedValue({
			success: true,
			updateAvailable: false,
			updateInfo: null
		});

		await expect(desktopHost.checkForUpdate()).resolves.toEqual({
			success: true,
			updateAvailable: false,
			updateInfo: null
		});

		expect(runtime.invoke).toHaveBeenCalledWith('check-for-update');
	});

	it('maps migrateElectronData to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			migrated: true,
			importedKeys: ['workspace_path'],
			warnings: [],
			localStorage: { workspace_path: '"/songs"' }
		});

		await expect(desktopHost.migrateElectronData()).resolves.toEqual({
			migrated: true,
			importedKeys: ['workspace_path'],
			warnings: [],
			localStorage: { workspace_path: '"/songs"' }
		});

		expect(runtime.invoke).toHaveBeenCalledWith('migrate_electron_data');
	});

	it('does not call Electron for migrateElectronData', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);

		await expect(desktopHost.migrateElectronData()).resolves.toEqual({
			migrated: false,
			importedKeys: [],
			warnings: [],
			localStorage: {}
		});

		expect(runtime.invoke).not.toHaveBeenCalled();
	});

	it('maps multi-part pathExists arguments for Tauri', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ exists: true, error: null });

		await expect(desktopHost.pathExists('/songs', 'DTXFiles.foo')).resolves.toEqual({
			exists: true,
			error: null
		});
		expect(runtime.invoke).toHaveBeenCalledWith('path_exists', {
			basePath: '/songs',
			pathParts: ['DTXFiles.foo']
		});
	});

	it('maps multi-part pathExists arguments for Electron', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		vi.mocked(runtime.invoke).mockResolvedValue({ exists: false, error: 'not-found' });

		await expect(desktopHost.pathExists('/songs', 'DTXFiles.foo')).resolves.toEqual({
			exists: false,
			error: 'not-found'
		});
		expect(runtime.invoke).toHaveBeenCalledWith('path-exists', '/songs', 'DTXFiles.foo');
	});

	it('reshapes Electron listDirectories responses into directory names', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		vi.mocked(runtime.invoke).mockResolvedValue({
			files: [
				{ name: 'DTXFiles.A', path: '/songs/DTXFiles.A', type: 'directory' },
				{ name: 'notes.dtx', path: '/songs/notes.dtx', type: 'file' }
			],
			error: null
		});

		await expect(desktopHost.listDirectories('/songs')).resolves.toEqual(['DTXFiles.A']);
		expect(runtime.invoke).toHaveBeenCalledWith('list-directory', '/songs');
	});

	it('throws Electron listDirectories errors', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		vi.mocked(runtime.invoke).mockResolvedValue({ files: [], error: 'permission denied' });

		await expect(desktopHost.listDirectories('/songs')).rejects.toThrow('permission denied');
	});

	it('maps readFile to the host command with workspaceRoot', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			error: null,
			content: '#TITLE: Song',
			isText: true
		});

		await expect(desktopHost.readFile('/songs/a.dtx', '/songs')).resolves.toEqual({
			error: null,
			content: '#TITLE: Song',
			isText: true
		});
		expect(runtime.invoke).toHaveBeenCalledWith('read_file', {
			filePath: '/songs/a.dtx',
			workspaceRoot: '/songs'
		});
	});

	it('normalizes Tauri readFile binary arrays into Uint8Array content', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			error: null,
			content: [1, 2, 3],
			isText: false
		});

		const result = await desktopHost.readFile('/songs/snare.wav', '/songs');

		expect(result.error).toBeNull();
		expect(result.isText).toBe(false);
		expect(result.content).toBeInstanceOf(Uint8Array);
		expect([...result.content]).toEqual([1, 2, 3]);
		expect(runtime.invoke).toHaveBeenCalledWith('read_file', {
			filePath: '/songs/snare.wav',
			workspaceRoot: '/songs'
		});
	});

	it('preserves Electron readFile binary content', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		const content = new Uint8Array([1, 2, 3]);
		vi.mocked(runtime.invoke).mockResolvedValue({
			error: null,
			content,
			isText: false
		});

		const result = await desktopHost.readFile('/songs/snare.wav', '/songs');

		expect(result.content).toBe(content);
		expect(runtime.invoke).toHaveBeenCalledWith('read-file', '/songs/snare.wav', '/songs');
	});

	it('uses send for external URLs', async () => {
		await desktopHost.openExternalUrl('https://example.com/login');
		expect(runtime.send).toHaveBeenCalledWith('open_external_url', {
			url: 'https://example.com/login'
		});
	});

	it('registers and removes magic-link listeners', async () => {
		const unlisten = vi.fn();
		vi.mocked(runtime.listen).mockResolvedValue(unlisten);
		const callback = vi.fn();

		const stop = await desktopHost.onMagicLinkResult(callback);
		expect(runtime.listen).toHaveBeenCalledWith('magic-link-result', callback);

		stop();
		expect(unlisten).toHaveBeenCalledTimes(1);
	});

	it('registers auth-callback listeners', async () => {
		const unlisten = vi.fn();
		vi.mocked(runtime.listen).mockResolvedValue(unlisten);
		const callback = vi.fn();

		const stop = await desktopHost.onAuthCallback(callback);

		expect(runtime.listen).toHaveBeenCalledWith('auth-callback', callback);
		stop();
		expect(unlisten).toHaveBeenCalledTimes(1);
	});

	it('removes host listeners by event name', () => {
		desktopHost.removeAllListeners('auth-callback');

		expect(runtime.removeAllListeners).toHaveBeenCalledWith('auth-callback');
	});

	it('drains pending auth events through Tauri only', async () => {
		await desktopHost.drainPendingAuthEvents();
		expect(runtime.invoke).toHaveBeenCalledWith('drain_pending_auth_events');

		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);

		await desktopHost.drainPendingAuthEvents();
		expect(runtime.invoke).not.toHaveBeenCalled();
	});

	it('returns environment values from the active runtime', () => {
		expect(desktopHost.getEnvironment()).toEqual({ HOME: '/Users/Test' });
		expect(runtime.getEnvironment).toHaveBeenCalled();
	});

	it('uses Tauri runtime when the global Tauri marker is present', async () => {
		setDesktopHostRuntimeForTests(null);
		Object.defineProperty(window, '__TAURI__', {
			configurable: true,
			value: {}
		});
		vi.mocked(tauriInvoke).mockResolvedValue({ canceled: false, filePaths: ['/songs'] });

		await expect(desktopHost.selectFolder()).resolves.toEqual({
			canceled: false,
			filePaths: ['/songs']
		});
		expect(tauriInvoke).toHaveBeenCalledWith('select_folder');
	});

	it('returns an empty environment for the Tauri runtime', () => {
		setDesktopHostRuntimeForTests(null);
		Object.defineProperty(window, '__TAURI__', {
			configurable: true,
			value: {}
		});

		expect(desktopHost.getEnvironment()).toEqual({});
	});

	it('uses Electron runtime when the Tauri marker is absent', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
			canceled: false,
			filePaths: ['/songs']
		});

		await expect(desktopHost.selectFolder()).resolves.toEqual({
			canceled: false,
			filePaths: ['/songs']
		});
		expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('select-folder');
	});

	it('returns Electron process environment when the Electron runtime is active', () => {
		setDesktopHostRuntimeForTests(null);

		expect(desktopHost.getEnvironment()).toBe(window.electron.process.env);
	});
});
