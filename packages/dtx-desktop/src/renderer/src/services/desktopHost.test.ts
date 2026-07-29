import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { getVersion, getTauriVersion } from '@tauri-apps/api/app';
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
	getDefaultDownloadsDir: vi.fn(async () => '/Users/Test/Downloads'),
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

	it('keeps workspace selection separate from generic folder selection', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ canceled: false, filePaths: ['/songs'] });

		await desktopHost.selectWorkspaceFolder();
		expect(runtime.invoke).toHaveBeenLastCalledWith('select_workspace_folder');

		await desktopHost.selectFolder();
		expect(runtime.invoke).toHaveBeenLastCalledWith('select_folder');
	});

	it('maps managed workspace state commands to Tauri', async () => {
		vi.mocked(runtime.invoke).mockResolvedValueOnce('/songs').mockResolvedValueOnce(undefined);

		await expect(desktopHost.getWorkspaceRoot()).resolves.toBe('/songs');
		await expect(desktopHost.clearWorkspaceRoot()).resolves.toBeUndefined();

		expect(runtime.invoke).toHaveBeenNthCalledWith(1, 'get_workspace_root');
		expect(runtime.invoke).toHaveBeenNthCalledWith(2, 'clear_workspace_root');
	});

	it('maps setWorkspaceRoot to the Tauri command with the bookmark path', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ outcome: 'ok', path: '/canonical' });

		await desktopHost.switchTrustedWorkspace('bookmark-id');

		expect(runtime.invoke).toHaveBeenLastCalledWith('switch_trusted_workspace', {
			id: 'bookmark-id'
		});
	});

	it('maps getCurrentWorkspaceRootId to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue('native-root-id');

		await expect(desktopHost.getCurrentWorkspaceRootId()).resolves.toBe('native-root-id');
		expect(runtime.invoke).toHaveBeenLastCalledWith('get_current_workspace_root_id');
	});

	it('maps bookmarkCurrentRoot to the Tauri command with a name', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ id: 'new-id', path: '/foo', name: 'Foo' });

		await desktopHost.bookmarkCurrentRoot('Foo');

		expect(runtime.invoke).toHaveBeenLastCalledWith('bookmark_current_root', { name: 'Foo' });
	});

	it('maps renameBookmark to the Tauri command with id and name', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue(undefined);

		await desktopHost.renameBookmark('bm-id', 'Renamed');

		expect(runtime.invoke).toHaveBeenLastCalledWith('rename_bookmark', {
			id: 'bm-id',
			name: 'Renamed'
		});
	});

	it('maps removeBookmark to the Tauri command with id', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue(undefined);

		await desktopHost.removeBookmark('bm-id');

		expect(runtime.invoke).toHaveBeenLastCalledWith('remove_bookmark', { id: 'bm-id' });
	});

	it('maps listBookmarks to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue([{ id: 'a', path: '/a', name: 'A' }]);

		await expect(desktopHost.listBookmarks()).resolves.toEqual([
			{ id: 'a', path: '/a', name: 'A' }
		]);
		expect(runtime.invoke).toHaveBeenLastCalledWith('list_bookmarks');
	});

	it('maps checkForUpdate to the Tauri command and returns an update when available', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			success: true,
			available: true,
			version: '2.0.0',
			body: 'release notes',
			date: '2026-06-18'
		});

		await expect(desktopHost.checkForUpdate()).resolves.toEqual({
			success: true,
			available: true,
			version: '2.0.0',
			body: 'release notes',
			date: '2026-06-18'
		});

		expect(runtime.invoke).toHaveBeenCalledWith('check_for_update');
	});

	it('maps checkForUpdate to the Tauri command when no update is available', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ success: true, available: false });

		await expect(desktopHost.checkForUpdate()).resolves.toEqual({
			success: true,
			available: false
		});
	});

	it('maps checkForUpdate to the Tauri command when the updater is unavailable', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			success: false,
			available: false,
			error: 'updater disabled'
		});

		await expect(desktopHost.checkForUpdate()).resolves.toEqual({
			success: false,
			available: false,
			error: 'updater disabled'
		});
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
			() => desktopHost.listDirectories('/songs'),
			'list_directories',
			{
				dirPath: '/songs'
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
		await expectTauriInvoke(
			'/path/songs.db',
			() => desktopHost.defaultDtxmaniaDbPath(),
			'default_dtxmania_db_path'
		);
		await expectTauriInvoke(
			{ canceled: false, filePaths: ['/path/songs.db'] },
			() => desktopHost.selectDtxmaniaDb(),
			'select_dtxmania_db'
		);
		await expectTauriInvoke(
			[],
			() => desktopHost.parseDtxmaniaScores('/path/songs.db'),
			'parse_dtxmania_scores',
			{ dbPath: '/path/songs.db' }
		);
		await expectTauriInvoke(
			{ success: true, data: [] },
			() => desktopHost.fetchCloudSongCharts('42'),
			'fetch_cloud_song_charts',
			{ cloudSongId: '42' }
		);
		await expectTauriInvoke(
			{ success: true, data: { updatedCharts: 1 } },
			() => desktopHost.uploadScores({ charts: [] }),
			'upload_scores',
			{ payload: { charts: [] } }
		);
		await expectTauriInvoke(
			{ ['Played SongArtist A']: '42' },
			() => desktopHost.readScoreSongLinks(),
			'read_score_song_links'
		);
	});

	it('maps writeScoreSongLinks to a fire-and-forget send command', async () => {
		await desktopHost.writeScoreSongLinks({ ['Played SongArtist A']: '42' });
		expect(runtime.send).toHaveBeenCalledWith('write_score_song_links', {
			links: { ['Played SongArtist A']: '42' }
		});
	});

	it('maps the bounded Drive connection commands without renderer-controlled identity data', async () => {
		vi.mocked(runtime.invoke)
			.mockResolvedValueOnce({ connected: false })
			.mockResolvedValueOnce({
				connected: true,
				folder: { id: 'folder-id', name: 'Exports' }
			})
			.mockResolvedValueOnce({
				connected: true,
				folder: { id: 'folder-id', name: 'Exports' }
			})
			.mockResolvedValueOnce({
				connected: true,
				folder: { id: 'folder-id', name: 'Exports' }
			})
			.mockResolvedValueOnce({
				connection: { connected: false },
				revocationUnconfirmed: false
			});

		await desktopHost.getGoogleDriveConnectionState();
		await desktopHost.connectGoogleDriveAndChooseFolder();
		await desktopHost.changeGoogleDriveFolder();
		await desktopHost.recheckGoogleDriveSharing();
		await desktopHost.disconnectGoogleDrive();

		expect(runtime.invoke.mock.calls).toEqual([
			['get_google_drive_connection_state'],
			['connect_google_drive_and_choose_folder'],
			['change_google_drive_folder'],
			['recheck_google_drive_sharing'],
			['disconnect_google_drive']
		]);
	});

	it('serializes only the bounded Drive upload transaction input', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ success: false, errorCode: 'CANCELED' });

		await desktopHost.uploadSongZipToGoogleDrive({
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
			simfileId: 'simfile-42',
			songRelativePath: 'songs/alpha',
			forceCreateReplacement: true
		});
		await desktopHost.cancelGoogleDriveUpload('f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8');

		expect(runtime.invoke).toHaveBeenNthCalledWith(1, 'upload_song_zip_to_google_drive', {
			input: {
				operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
				simfileId: 'simfile-42',
				songRelativePath: 'songs/alpha',
				forceCreateReplacement: true
			}
		});
		expect(runtime.invoke).toHaveBeenNthCalledWith(2, 'cancel_google_drive_upload', {
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8'
		});

		// No forbidden-key sweep needed: toHaveBeenNthCalledWith above asserts
		// the exact payload shape for every invoke call in this test, so any
		// leaked key (userId, workspaceRoot, absolutePath, folderId, title,
		// existingDriveId, downloadUrl, credential) would already fail.
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

	it('maps readFile to the host command without renderer trust state', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			kind: 'text',
			error: null,
			content: '#TITLE: Song'
		});

		await expect(desktopHost.readFile('/songs/a.dtx')).resolves.toEqual({
			kind: 'text',
			error: null,
			content: '#TITLE: Song'
		});
		expect(runtime.invoke).toHaveBeenCalledWith('read_file', {
			filePath: '/songs/a.dtx'
		});
	});

	it('normalizes Tauri readFile binary arrays into Uint8Array content', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			kind: 'binary',
			error: null,
			content: [1, 2, 3]
		});

		const result = await desktopHost.readFile('/songs/snare.wav');

		expect(result.kind).toBe('binary');
		expect(result.error).toBeNull();
		expect(result.content).toBeInstanceOf(Uint8Array);
		expect([...result.content]).toEqual([1, 2, 3]);
		expect(runtime.invoke).toHaveBeenCalledWith('read_file', {
			filePath: '/songs/snare.wav'
		});
	});

	it('never includes a renderer-controlled root in an IPC payload', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ exists: true, error: null });

		await desktopHost.pathExists('/songs', 'song');

		for (const call of vi.mocked(runtime.invoke).mock.calls) {
			const payload = call[1] as Record<string, unknown> | undefined;
			expect(Object.keys(payload ?? {})).not.toContain('workspace' + 'Root');
		}
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

	it('registers and removes session-refreshed listeners', async () => {
		const unlisten = vi.fn();
		vi.mocked(runtime.listen).mockResolvedValue(unlisten);
		const callback = vi.fn();

		const stop = await desktopHost.onSessionRefreshed(callback);
		expect(runtime.listen).toHaveBeenCalledWith('session-refreshed', callback);

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

	it('delegates getDefaultDownloadsDir to the active runtime', async () => {
		vi.mocked(runtime.getDefaultDownloadsDir).mockResolvedValue('/Users/Test/Downloads');

		await expect(desktopHost.getDefaultDownloadsDir()).resolves.toBe('/Users/Test/Downloads');
		expect(runtime.getDefaultDownloadsDir).toHaveBeenCalled();
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

	it('invokes get_default_downloads_dir through the Tauri runtime', async () => {
		// When the runtime falls back to createTauriRuntime() (no test runtime
		// set, __TAURI__ present), getDefaultDownloadsDir must invoke the
		// registered `get_default_downloads_dir` Rust command rather than
		// hard-coding null, so the native OS Downloads path is returned.
		setDesktopHostRuntimeForTests(null);
		Object.defineProperty(window, '__TAURI__', {
			configurable: true,
			value: {}
		});
		vi.mocked(tauriInvoke).mockResolvedValue('/native/Downloads');

		await expect(desktopHost.getDefaultDownloadsDir()).resolves.toBe('/native/Downloads');
		expect(tauriInvoke).toHaveBeenCalledWith('get_default_downloads_dir');
	});

	it('falls back to null when get_default_downloads_dir IPC rejects', async () => {
		// If the command is unavailable (e.g. a headless/CI window without the
		// command wired up), resolve to null instead of surfacing the error.
		setDesktopHostRuntimeForTests(null);
		Object.defineProperty(window, '__TAURI__', {
			configurable: true,
			value: {}
		});
		vi.mocked(tauriInvoke).mockRejectedValue(new Error('command not registered'));

		await expect(desktopHost.getDefaultDownloadsDir()).resolves.toBeNull();
		expect(tauriInvoke).toHaveBeenCalledWith('get_default_downloads_dir');
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

	it('passes args through Tauri invoke when the command has arguments', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(tauriInvoke).mockResolvedValue({ success: true, error: undefined });

		await desktopHost.openFolder('/songs');
		expect(tauriInvoke).toHaveBeenCalledWith('open_folder', { folderPath: '/songs' });
	});

	it('routes send calls through tauriInvoke for fire-and-forget commands', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(tauriInvoke).mockResolvedValue(undefined);

		await desktopHost.openExternalUrl('https://example.com');
		expect(tauriInvoke).toHaveBeenCalledWith('open_external_url', {
			url: 'https://example.com'
		});
	});

	it('wraps tauri listen callbacks and tracks unlisten registration', async () => {
		setDesktopHostRuntimeForTests(null);
		const tauriUnlisten = vi.fn();
		let capturedCallback: ((event: { payload: unknown }) => void) | null = null;
		vi.mocked(tauriListen).mockImplementation(async (_event, cb) => {
			capturedCallback = cb;
			return tauriUnlisten;
		});

		const userCallback = vi.fn();
		const stop = await desktopHost.onMagicLinkResult(userCallback);

		expect(tauriListen).toHaveBeenCalledWith('magic-link-result', expect.any(Function));

		// Verify the payload is unwrapped before reaching the user callback
		capturedCallback!({ payload: { success: true } });
		expect(userCallback).toHaveBeenCalledWith({ success: true });

		// Calling stop should invoke the underlying tauri unlisten
		stop();
		expect(tauriUnlisten).toHaveBeenCalledTimes(1);
	});

	it('removes all tracked listeners for a specific event via removeAllListeners', async () => {
		setDesktopHostRuntimeForTests(null);
		const tauriUnlisten = vi.fn();
		vi.mocked(tauriListen).mockResolvedValue(tauriUnlisten);

		await desktopHost.onMagicLinkResult(vi.fn());
		await desktopHost.onMagicLinkResult(vi.fn());

		desktopHost.removeAllListeners('magic-link-result');

		// Both registrations should have been cleaned up
		expect(tauriUnlisten).toHaveBeenCalledTimes(2);
	});

	it('removes all tracked listeners across every event when no event name is given', async () => {
		setDesktopHostRuntimeForTests(null);
		const tauriUnlisten = vi.fn();
		vi.mocked(tauriListen).mockResolvedValue(tauriUnlisten);

		await desktopHost.onMagicLinkResult(vi.fn());

		desktopHost.removeAllListeners();
		expect(tauriUnlisten).toHaveBeenCalledTimes(1);
	});

	it('does not throw when removeAllListeners targets an event with no listeners', () => {
		setDesktopHostRuntimeForTests(null);
		expect(() => desktopHost.removeAllListeners('nonexistent-event')).not.toThrow();
	});

	it('normalizes readFile text results through the Tauri runtime without conversion', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(tauriInvoke).mockResolvedValue({
			kind: 'text',
			error: null,
			content: '#TITLE Test'
		});

		const result = await desktopHost.readFile('/songs/a.dtx');
		expect(result.kind).toBe('text');
		expect(result.content).toBe('#TITLE Test');
	});

	it('normalizes readFile error results through the Tauri runtime without conversion', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(tauriInvoke).mockResolvedValue({
			kind: 'error',
			error: 'permission-denied',
			content: ''
		});

		const result = await desktopHost.readFile('/songs/a.dtx');
		expect(result.kind).toBe('error');
		expect(result.error).toBe('permission-denied');
	});

	it('accepts a string argument for fetchCloudSong', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ success: true });

		await desktopHost.fetchCloudSong('42');

		expect(runtime.invoke).toHaveBeenCalledWith('fetch_cloud_song', { cloudSongId: '42' });
	});

	it('accepts a numeric argument for fetchCloudSong', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ success: true });

		await desktopHost.fetchCloudSong(99);

		expect(runtime.invoke).toHaveBeenCalledWith('fetch_cloud_song', { cloudSongId: 99 });
	});

	it('resolves app and tauri versions from the Tauri runtime', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(getVersion).mockResolvedValue('2.1.0');
		vi.mocked(getTauriVersion).mockResolvedValue('2.4.1');

		await expect(desktopHost.getVersions()).resolves.toEqual({
			app: '2.1.0',
			tauri: '2.4.1'
		});
	});

	it('falls back to null versions when Tauri version APIs reject', async () => {
		setDesktopHostRuntimeForTests(null);
		vi.mocked(getVersion).mockRejectedValue(new Error('unavailable'));
		vi.mocked(getTauriVersion).mockRejectedValue(new Error('unavailable'));

		await expect(desktopHost.getVersions()).resolves.toEqual({
			app: null,
			tauri: null
		});
	});

	it('detects darwin platform from navigator', () => {
		setDesktopHostRuntimeForTests(null);
		vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');

		expect(desktopHost.getPlatform()).toBe('darwin');
	});

	it('detects win32 platform from navigator', () => {
		setDesktopHostRuntimeForTests(null);
		vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');

		expect(desktopHost.getPlatform()).toBe('win32');
	});

	it('detects linux platform from navigator', () => {
		setDesktopHostRuntimeForTests(null);
		vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');

		expect(desktopHost.getPlatform()).toBe('linux');
	});

	it('returns the raw platform string when no known platform matches', () => {
		setDesktopHostRuntimeForTests(null);
		vi.spyOn(navigator, 'platform', 'get').mockReturnValue('SunOS');

		expect(desktopHost.getPlatform()).toBe('sunos');
	});

	it('returns unknown when navigator is undefined', () => {
		setDesktopHostRuntimeForTests(null);
		const originalNavigator = globalThis.navigator;
		Object.defineProperty(globalThis, 'navigator', {
			value: undefined,
			configurable: true,
			writable: true
		});

		expect(desktopHost.getPlatform()).toBe('unknown');

		Object.defineProperty(globalThis, 'navigator', {
			value: originalNavigator,
			configurable: true,
			writable: true
		});
	});
});
