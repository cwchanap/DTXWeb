import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopHost, setDesktopHostRuntimeForTests, type DesktopHostRuntime } from './desktopHost';

const makeRuntime = (kind: DesktopHostRuntime['kind'] = 'tauri'): DesktopHostRuntime => ({
	kind,
	invoke: vi.fn(),
	send: vi.fn(),
	listen: vi.fn(),
	removeAllListeners: vi.fn(),
	getPlatform: vi.fn(() => 'darwin'),
	getVersions: vi.fn(() => ({ app: '1.0.0', tauri: null, electron: '35.0.0' }))
});

describe('desktopHost', () => {
	let runtime: DesktopHostRuntime;

	beforeEach(() => {
		runtime = makeRuntime();
		setDesktopHostRuntimeForTests(runtime);
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

		await desktopHost.selectFolder();

		expect(runtime.invoke).toHaveBeenCalledWith('select-folder');
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
});
