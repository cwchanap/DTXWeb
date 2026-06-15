import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { desktopHost, setDesktopHostRuntimeForTests, type DesktopHostRuntime } from './desktopHost';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn()
}));

vi.mock('@tauri-apps/api/app', () => ({
	getVersion: vi.fn(),
	getTauriVersion: vi.fn()
}));

const makeRuntime = (): DesktopHostRuntime => ({
	kind: 'tauri',
	invoke: vi.fn(),
	send: vi.fn(),
	listen: vi.fn(),
	removeAllListeners: vi.fn(),
	getPlatform: vi.fn(() => 'darwin'),
	getEnvironment: vi.fn(() => ({ HOME: '/Users/Test' })),
	getVersions: vi.fn(async () => ({ app: '1.0.0', tauri: '2' }))
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

	it('maps checkForUpdate to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ success: true, updateInfo: null });

		await expect(desktopHost.checkForUpdate()).resolves.toEqual({
			success: true,
			updateInfo: null
		});

		expect(runtime.invoke).toHaveBeenCalledWith('check_for_update');
	});

	it('maps migrateLegacyData to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			migrated: true,
			importedKeys: ['workspace_path'],
			warnings: [],
			localStorage: { workspace_path: '"/songs"' }
		});

		await expect(desktopHost.migrateLegacyData()).resolves.toEqual({
			migrated: true,
			importedKeys: ['workspace_path'],
			warnings: [],
			localStorage: { workspace_path: '"/songs"' }
		});

		expect(runtime.invoke).toHaveBeenCalledWith('migrate_legacy_data');
	});

	it('maps renderer methods to Tauri snake_case commands', async () => {
		const expectTauriInvoke = async (
			returnValue: unknown,
			call: () => Promise<unknown>,
			command: string,
			args?: Record<string, unknown>
		) => {
			vi.mocked(runtime.invoke).mockResolvedValueOnce(returnValue);

			await call();

			if (args === undefined) {
				expect(runtime.invoke).toHaveBeenLastCalledWith(command);
				return;
			}

			expect(runtime.invoke).toHaveBeenLastCalledWith(command, args);
		};

		await expectTauriInvoke(
			{ success: true },
			() => desktopHost.openFolder('/songs'),
			'open_folder',
			{
				folderPath: '/songs'
			}
		);
		await expectTauriInvoke(
			[],
			() => desktopHost.listDirectories('/songs', '/songs'),
			'list_directories',
			{
				dirPath: '/songs',
				workspaceRoot: '/songs'
			}
		);
		await expectTauriInvoke({}, () => desktopHost.listDirectory('/songs'), 'list_directory', {
			dirPath: '/songs'
		});
		await expectTauriInvoke(
			{},
			() => desktopHost.loadTreeStructure('/songs', 'DTXFiles.A'),
			'load_tree_structure',
			{
				basePath: '/songs',
				pathParts: ['DTXFiles.A']
			}
		);
		await expectTauriInvoke({}, () => desktopHost.listFiles('/songs/A'), 'list_files', {
			dirPath: '/songs/A'
		});
		await expectTauriInvoke(
			{},
			() => desktopHost.getSkinAsset('default/Graphics/7_pads.png'),
			'get_skin_asset',
			{
				assetPath: 'default/Graphics/7_pads.png'
			}
		);
		await expectTauriInvoke(
			{},
			() => desktopHost.parseDtxFiles('/songs/A'),
			'parse_dtx_files',
			{
				folderPath: '/songs/A'
			}
		);
		await expectTauriInvoke(
			true,
			() => desktopHost.validateSession({ accessToken: 'a', refreshToken: 'r' }),
			'validate_session',
			{
				sessionData: { accessToken: 'a', refreshToken: 'r' }
			}
		);
		await expectTauriInvoke({}, () => desktopHost.getCurrentSession(), 'get_current_session');
		await expectTauriInvoke(true, () => desktopHost.logoutSession(), 'logout_session');
		await expectTauriInvoke([], () => desktopHost.fetchUserSimfiles(), 'fetch_user_simfiles');
		await expectTauriInvoke(
			'https://files/42/preview.jpg',
			() => desktopHost.getPreviewUrl(42),
			'get_preview_url',
			{
				simfileId: 42
			}
		);
		await expectTauriInvoke(
			'https://files/42/preview.mp3',
			() => desktopHost.getSoundPreviewUrl(42),
			'get_sound_preview_url',
			{
				simfileId: 42
			}
		);
		await expectTauriInvoke([], () => desktopHost.loadAssetFiles('42'), 'load_asset_files', {
			simfileId: '42'
		});
		await expectTauriInvoke(
			{ success: true },
			() => desktopHost.createSong({ selectedPath: '/songs' }),
			'create_song',
			{
				options: { selectedPath: '/songs' }
			}
		);
		await expectTauriInvoke(
			{ success: true },
			() => desktopHost.createSimfileRecord({ title: 'Song' }),
			'create_simfile_record',
			{
				simfileData: { title: 'Song' }
			}
		);
		await expectTauriInvoke(43, () => desktopHost.getNextDisplayId(), 'get_next_display_id');
		await expectTauriInvoke(
			{ success: true, data: [] },
			() =>
				desktopHost.searchCloudSongs({
					query: 'song',
					limit: 20,
					excludeLinkedSongIds: ['42']
				}),
			'search_cloud_songs',
			{
				query: 'song',
				limit: 20,
				excludeLinkedSongIds: ['42']
			}
		);
		await expectTauriInvoke(
			{ success: true },
			() => desktopHost.fetchCloudSong({ cloudSongId: '42' }),
			'fetch_cloud_song',
			{
				cloudSongId: '42'
			}
		);
		await expectTauriInvoke(
			{ success: true },
			() =>
				desktopHost.updateSimfileRecord({
					simfileId: '42',
					updateData: { title: 'New' }
				}),
			'update_simfile_record',
			{
				simfileId: '42',
				updateData: { title: 'New' }
			}
		);
		await expectTauriInvoke(
			{ success: true },
			() => desktopHost.exportSongToZip({ songPath: '/songs/A' }),
			'export_song_to_zip',
			{
				songPath: '/songs/A'
			}
		);
		await expectTauriInvoke(
			{ success: true },
			() => desktopHost.uploadFile('main.dtx', '/songs/A', '42'),
			'upload_file',
			{
				fileName: 'main.dtx',
				songFolderPath: '/songs/A',
				simfileId: '42'
			}
		);
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

	it('removes host listeners by event name', () => {
		desktopHost.removeAllListeners('magic-link-result');

		expect(runtime.removeAllListeners).toHaveBeenCalledWith('magic-link-result');
	});

	it('drains pending auth events through Tauri only', async () => {
		await desktopHost.drainPendingAuthEvents();
		expect(runtime.invoke).toHaveBeenCalledWith('drain_pending_auth_events');
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

	it('uses the Tauri runtime when the global Tauri marker is absent', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(tauriInvoke).mockResolvedValue({
			canceled: false,
			filePaths: ['/songs']
		});

		await expect(desktopHost.selectFolder()).resolves.toEqual({
			canceled: false,
			filePaths: ['/songs']
		});
		expect(tauriInvoke).toHaveBeenCalledWith('select_folder');
	});
});
