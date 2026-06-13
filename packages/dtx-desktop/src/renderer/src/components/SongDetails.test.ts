import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { TreeNode } from '../stores/workspaceStore';

vi.mock('@lucide/svelte');

vi.mock('@dtx/common/components');

vi.mock('@dtx/common', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@dtx/common')>();
	return {
		...actual,
		isValidDtxFile: vi.fn().mockReturnValue(true)
	};
});

vi.mock('./CloudSongAutocomplete.svelte', () => ({ default: vi.fn() }));

const { mockDesktopHost, mockHostInvoke } = vi.hoisted(() => {
	const hostInvoke = vi.fn();
	return {
		mockHostInvoke: hostInvoke,
		mockDesktopHost: {
			listFiles: vi.fn((dirPath: string) => hostInvoke('list-files', dirPath)),
			readFile: vi.fn((filePath: string, workspaceRoot: string | null = null) =>
				hostInvoke('read-file', filePath, workspaceRoot)
			),
			loadAssetFiles: vi.fn((simfileId: string) => hostInvoke('load-asset-files', simfileId)),
			createSimfileRecord: vi.fn((simfileData: unknown) =>
				hostInvoke('create-simfile-record', simfileData)
			),
			getNextDisplayId: vi.fn(() => hostInvoke('get-next-display-id')),
			fetchCloudSong: vi.fn((params: unknown) => hostInvoke('fetch-cloud-song', params)),
			updateSimfileRecord: vi.fn((params: unknown) =>
				hostInvoke('update-simfile-record', params)
			),
			exportSongToZip: vi.fn((params: unknown) => hostInvoke('export-song-to-zip', params)),
			parseDtxFiles: vi.fn((folderPath: string) => hostInvoke('parse-dtx-files', folderPath)),
			uploadFile: vi.fn((fileName: string, songFolderPath: string, simfileId: string) =>
				hostInvoke('upload-file', fileName, songFolderPath, simfileId)
			)
		}
	};
});

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

// Mutable state for workspaceStore mock
const initialWorkspaceState = {
	path: null as string | null,
	currentSubWorkspace: null as string | null,
	subWorkspaces: [] as string[],
	treeStructure: [] as TreeNode[],
	isLoading: false,
	error: null as string | null,
	selectedSong: null as TreeNode | null,
	showSongDetails: false,
	showNewSong: false,
	showTemplates: false
};
let workspaceState = { ...initialWorkspaceState };
const workspaceListeners: Array<(s: typeof workspaceState) => void> = [];

vi.mock('../stores/workspaceStore', () => ({
	workspaceStore: {
		subscribe: vi.fn((cb: (s: typeof workspaceState) => void) => {
			cb(workspaceState);
			workspaceListeners.push(cb);
			return () => {
				const index = workspaceListeners.indexOf(cb);
				if (index >= 0) workspaceListeners.splice(index, 1);
			};
		}),
		closeSongDetails: vi.fn(),
		linkSimFileToFolder: vi.fn()
	}
}));

vi.mock('../stores/settingsStore', () => ({
	settingsStore: {
		subscribe: vi.fn((cb: (s: { exportDirectory: string }) => void) => {
			cb({ exportDirectory: '~/Downloads' });
			return () => {};
		})
	}
}));

vi.mock('../stores/editorMappingStore', () => ({
	editorMappingStore: {
		setMappingWithMetadata: vi.fn()
	}
}));

let authState = {
	isAuthenticated: false,
	isLoading: false,
	user: null as null,
	error: null as null
};

vi.mock('../stores/authStore', () => ({
	authStore: {
		subscribe: vi.fn((cb: (s: typeof authState) => void) => {
			cb(authState);
			return () => {};
		})
	}
}));

import SongDetails from './SongDetails.svelte';
import { workspaceStore } from '../stores/workspaceStore';
import { editorMappingStore } from '../stores/editorMappingStore';
import { ChartDetail } from '@dtx/common/components';

const makeNode = (
	name: string,
	path = `/test/${name}`,
	overrides: Partial<TreeNode> = {}
): TreeNode => ({
	name,
	path,
	isExpanded: false,
	isLoading: false,
	children: [],
	hasChildren: false,
	containsDtxFiles: false,
	songTitle: null,
	linkedSimFileId: null,
	linkedSimFile: null,
	...overrides
});

const makeLinkedSimFile = () => ({
	id: 1,
	title: 'Test Song',
	artist: 'Test Artist',
	bpm: 120,
	is_published: false,
	publish_date: '2024-01-01',
	display_id: 1,
	download_url: '',
	preview_url: '',
	video_preview_url: '',
	dtx_files: []
});

const getLastProps = <T>(mockFn: ReturnType<typeof vi.fn>): T | undefined => {
	const calls = mockFn.mock.calls;
	const lastCall = calls[calls.length - 1];
	return (lastCall?.[1] ?? lastCall?.[0]) as T | undefined;
};

type ChartDetailTestProps = {
	simfile?: { display_id?: number | null };
	$$events?: {
		onSave?: (event: { detail: Record<string, unknown> }) => Promise<void> | void;
	};
};

const getNextDisplayIdCallCount = () =>
	mockHostInvoke.mock.calls.filter(([channel]) => channel === 'get-next-display-id').length;

describe('SongDetails', () => {
	beforeEach(() => {
		workspaceState = { ...initialWorkspaceState };
		workspaceListeners.length = 0;
		authState = { isAuthenticated: false, isLoading: false, user: null, error: null };
		vi.clearAllMocks();
		mockHostInvoke.mockResolvedValue({ files: [] });
	});

	afterEach(() => {
		cleanup();
	});

	describe('rendering – unlinked song', () => {
		it('renders without error for a basic unlinked song', () => {
			const song = makeNode('TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('renders container div for unlinked song', () => {
			const song = makeNode('TestSong');
			const { container } = render(SongDetails, { props: { song } });
			expect(container.firstChild).not.toBeNull();
		});

		it('invokes list-files IPC on mount with song path', async () => {
			const song = makeNode('TestSong', '/my/songs/TestSong');
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('list-files', '/my/songs/TestSong');
			});
		});

		it('does not invoke list-files IPC when song has no path', () => {
			const song = makeNode('TestSong', '');
			render(SongDetails, { props: { song } });
			expect(mockHostInvoke).not.toHaveBeenCalledWith('list-files', expect.anything());
		});
	});

	describe('rendering – linked song', () => {
		it('renders without error for a linked song', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: makeLinkedSimFile(),
				linkedSimFileId: '1'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('renders container div for linked song', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: makeLinkedSimFile(),
				linkedSimFileId: '1'
			});
			const { container } = render(SongDetails, { props: { song } });
			expect(container.firstChild).not.toBeNull();
		});

		it('invokes list-files IPC on mount for linked song', async () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: makeLinkedSimFile(),
				linkedSimFileId: '1'
			});
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('list-files', '/test/TestSong');
			});
		});

		it('invokes parse-dtx-files IPC when linked simfile is missing BPM', async () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: { ...makeLinkedSimFile(), bpm: undefined as unknown as number },
				linkedSimFileId: '1'
			});
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('parse-dtx-files', '/test/TestSong');
			});
		});
	});

	describe('IPC error handling', () => {
		it('handles list-files IPC error gracefully', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockRejectedValueOnce(new Error('IPC error'));
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('handles list-files returning error field', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockResolvedValueOnce({ files: [], error: 'Directory not found' });
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});
	});

	describe('store interactions', () => {
		it('renders without error when workspaceStore has treeStructure', () => {
			workspaceState = {
				...workspaceState,
				treeStructure: [makeNode('Folder', '/ws/Folder')]
			};
			const song = makeNode('TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('subscribes to authStore on render', async () => {
			const { authStore } = await import('../stores/authStore');
			const song = makeNode('TestSong');
			render(SongDetails, { props: { song } });
			expect(authStore.subscribe).toHaveBeenCalled();
		});

		it('subscribes to settingsStore on render', async () => {
			const { settingsStore } = await import('../stores/settingsStore');
			const song = makeNode('TestSong');
			render(SongDetails, { props: { song } });
			expect(settingsStore.subscribe).toHaveBeenCalled();
		});
	});

	describe('handleClose', () => {
		it('does not call closeSongDetails on initial render', () => {
			const song = makeNode('TestSong');
			render(SongDetails, { props: { song } });
			expect(workspaceStore.closeSongDetails).not.toHaveBeenCalled();
		});
	});

	describe('isSimfileWithDtx type guard', () => {
		it('renders with song that has dtx_files in linked simfile', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: {
					...makeLinkedSimFile(),
					dtx_files: [{ id: 1, label: 'BASIC', level: 30, simfile_id: 1 }]
				},
				linkedSimFileId: '1'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});
	});

	describe('song with various properties', () => {
		it('renders song with songTitle', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				songTitle: 'My Custom Song Title'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('renders song with containsDtxFiles=true', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				containsDtxFiles: true
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('renders song without path (empty path)', () => {
			const song = makeNode('TestSong', '');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('renders linked song where simfile has null artist', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: {
					...makeLinkedSimFile(),
					artist: null as unknown as string
				},
				linkedSimFileId: '1'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('renders linked song where simfile has null bpm triggers parse', async () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: {
					...makeLinkedSimFile(),
					bpm: null as unknown as number
				},
				linkedSimFileId: '1'
			});
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('parse-dtx-files', '/test/TestSong');
			});
		});
	});

	describe('parse-dtx-files IPC response handling', () => {
		it('handles successful parse-dtx-files response', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'list-files') return { files: [] };
					if (channel === 'parse-dtx-files') {
						return {
							bpm: 140,
							artist: 'Test Artist',
							levels: [{ label: 'BASIC', level: 30 }]
						};
					}
					return null;
				});
			}
			// Song with missing bpm to trigger parse
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: { ...makeLinkedSimFile(), bpm: undefined as unknown as number },
				linkedSimFileId: '1'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('handles null parse-dtx-files response', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'list-files') return { files: [] };
					if (channel === 'parse-dtx-files') return null;
					return null;
				});
			}
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: { ...makeLinkedSimFile(), bpm: undefined as unknown as number },
				linkedSimFileId: '1'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('handles parse-dtx-files IPC error', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'list-files') return { files: [] };
					if (channel === 'parse-dtx-files') throw new Error('Parse failed');
					return null;
				});
			}
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: { ...makeLinkedSimFile(), bpm: undefined as unknown as number },
				linkedSimFileId: '1'
			});
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});
	});

	describe('list-files file loading', () => {
		it('loads and processes file list from IPC', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'list-files') {
						return {
							files: [
								{
									fileName: 'song.dtx',
									key: '/test/TestSong/song.dtx',
									lastModified: 1000
								},
								{
									fileName: 'hi_hat.wav',
									key: '/test/TestSong/hi_hat.wav',
									lastModified: 2000
								}
							]
						};
					}
					if (channel === 'read-file') {
						return { content: 'file content', error: null };
					}
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('handles read-file errors during file loading', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'list-files') {
						return {
							files: [
								{
									fileName: 'song.dtx',
									key: '/test/TestSong/song.dtx',
									lastModified: 1000
								}
							]
						};
					}
					if (channel === 'read-file') {
						return { content: null, error: 'Permission denied' };
					}
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('handles read-file throwing during file loading', async () => {
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'list-files') {
						return {
							files: [
								{
									fileName: 'song.dtx',
									key: '/test/TestSong/song.dtx',
									lastModified: 1000
								}
							]
						};
					}
					if (channel === 'read-file') throw new Error('Read error');
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});
	});

	describe('handleOpenEditor', () => {
		it('does not call setMappingWithMetadata on initial render', () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFileId: '42',
				songTitle: 'My Song'
			});
			render(SongDetails, { props: { song } });
			expect(editorMappingStore.setMappingWithMetadata).not.toHaveBeenCalled();
		});
	});

	describe('auto-populate display_id', () => {
		it('invokes get-next-display-id for unlinked songs when authenticated', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') return 42;
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('get-next-display-id');
			});
		});

		it('does not invoke get-next-display-id for linked songs', async () => {
			authState = { ...authState, isAuthenticated: true };
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: makeLinkedSimFile(),
				linkedSimFileId: '1'
			});
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('list-files', '/test/TestSong');
			});
			expect(mockHostInvoke).not.toHaveBeenCalledWith('get-next-display-id');
		});

		it('preserves a linked non-zero display_id instead of auto-populating over it', async () => {
			authState = { ...authState, isAuthenticated: true };
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: { ...makeLinkedSimFile(), display_id: 7 },
				linkedSimFileId: '1'
			});
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
			});
			const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
			expect(props?.simfile?.display_id).toBe(7);
			expect(mockHostInvoke).not.toHaveBeenCalledWith('get-next-display-id');
		});

		it('does not invoke get-next-display-id when not authenticated', async () => {
			const song = makeNode('TestSong', '/test/TestSong');
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('list-files', '/test/TestSong');
			});
			expect(mockHostInvoke).not.toHaveBeenCalledWith('get-next-display-id');
		});

		it('does not invoke get-next-display-id when song has no path', async () => {
			authState = { ...authState, isAuthenticated: true };
			const song = makeNode('TestSong', '');
			render(SongDetails, { props: { song } });
			await tick();
			expect(mockHostInvoke).not.toHaveBeenCalledWith('get-next-display-id');
		});

		it('handles get-next-display-id IPC error gracefully', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') throw new Error('IPC error');
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('retries get-next-display-id for a failed path when the song is reopened', async () => {
			authState = { ...authState, isAuthenticated: true };
			let getNextCalls = 0;
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') {
						getNextCalls += 1;
						if (getNextCalls === 1) throw new Error('IPC error');
						return 43;
					}
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			const { rerender } = render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(getNextCalls).toBe(1);
			});

			await rerender({ props: { song: makeNode('EmptySong', '') } });
			await rerender({ props: { song } });
			await waitFor(() => {
				expect(getNextCalls).toBe(2);
			});
		});

		it('sends null displayId when saving an auto-populated display_id', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') return 42;
					if (channel === 'parse-dtx-files') {
						return { bpm: 120, artist: 'Artist', levels: [{ label: 'EXT', level: 9 }] };
					}
					if (channel === 'create-simfile-record') {
						return {
							success: true,
							simfileId: '99',
							data: {
								id: 99,
								title: 'TestSong',
								artist: 'Artist',
								bpm: 120,
								display_id: 42,
								is_published: false,
								publish_date: '2024-01-01',
								download_url: '',
								preview_url: '',
								video_preview_url: '',
								dtx_files: []
							}
						};
					}
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong', { containsDtxFiles: true });
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('get-next-display-id');
			});
			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				expect(props?.simfile?.display_id).toBe(42);
			});

			const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
			await props?.$$events?.onSave?.({
				detail: {
					displayId: 42,
					publishDate: '2024-01-01',
					isPublished: false,
					downloadUrl: '',
					videoPreviewUrl: ''
				}
			});

			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith(
					'create-simfile-record',
					expect.objectContaining({ displayId: null })
				);
			});
		});

		it('does not duplicate get-next-display-id calls when effect re-triggers during in-flight request', async () => {
			authState = { ...authState, isAuthenticated: true };
			let resolveIpc: (() => void) | undefined;
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') {
						// Hold the request open so we can observe duplicate calls
						await new Promise<void>((resolve) => {
							resolveIpc = resolve;
						});
						return 42;
					}
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			render(SongDetails, { props: { song } });

			// Wait for the first IPC call to start
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('get-next-display-id');
			});
			const callCountBefore = getNextDisplayIdCallCount();

			resolveIpc?.();
			await waitFor(() => {
				expect(getNextDisplayIdCallCount()).toBe(callCountBefore);
			});

			expect(getNextDisplayIdCallCount()).toBe(callCountBefore);
		});

		it('restores cached displayId and does not re-fetch when switching back to a previously populated song', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') return 42;
					return { files: [] };
				});
			}
			const songA = makeNode('SongA', '/test/SongA');
			const { rerender } = render(SongDetails, { props: { song: songA } });

			// Wait for songA's get-next-display-id to fire and displayId to be set
			await waitFor(() => {
				expect(mockHostInvoke).toHaveBeenCalledWith('get-next-display-id');
			});
			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				expect(props?.simfile?.display_id).toBe(42);
			});
			const callsAfterSongA = getNextDisplayIdCallCount();

			const songB = makeNode('SongB', '/test/SongB');
			await rerender({ props: { song: songB } });
			await waitFor(() => {
				expect(getNextDisplayIdCallCount()).toBe(callsAfterSongA + 1);
			});
			const callsAfterSongB = getNextDisplayIdCallCount();

			// Switch back to SongA — should restore cached ID without re-fetching
			await rerender({ props: { song: songA } });
			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				expect(props?.simfile?.display_id).toBe(42);
			});
			expect(getNextDisplayIdCallCount()).toBe(callsAfterSongB);
		});

		it('resets auto-populated displayId when switching between unlinked songs', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = mockHostInvoke;
			let nextDisplayId = 42;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') return nextDisplayId++;
					return { files: [] };
				});
			}
			const songA = makeNode('SongA', '/test/SongA');
			const { rerender } = render(SongDetails, { props: { song: songA } });

			// Wait for SongA to get display_id = 42
			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				expect(props?.simfile?.display_id).toBe(42);
			});

			// Switch to SongB — displayId should reset and fetch a new value
			const songB = makeNode('SongB', '/test/SongB');
			await rerender({ props: { song: songB } });

			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				// SongB should get display_id = 43, not the stale 42 from SongA
				expect(props?.simfile?.display_id).toBe(43);
			});
		});

		it('ignores stale get-next-display-id response when user switches songs before resolution', async () => {
			authState = { ...authState, isAuthenticated: true };
			let resolveSongA: ((value: number) => void) | undefined;
			let resolveSongB: ((value: number) => void) | undefined;
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') {
						// Determine which request this is based on in-flight state
						// SongA's request is created first; once we resolve SongA's, SongB's is next
						if (resolveSongA === undefined) {
							return new Promise<number>((resolve) => {
								resolveSongA = resolve;
							});
						}
						return new Promise<number>((resolve) => {
							resolveSongB = resolve;
						});
					}
					return { files: [] };
				});
			}

			const songA = makeNode('SongA', '/test/SongA');
			const { rerender } = render(SongDetails, { props: { song: songA } });

			// Wait for SongA's get-next-display-id IPC to start
			await waitFor(() => {
				expect(resolveSongA).toBeDefined();
			});

			// Switch to SongB while SongA's request is still in-flight
			const songB = makeNode('SongB', '/test/SongB');
			await rerender({ props: { song: songB } });

			// Wait for SongB's get-next-display-id IPC to start
			await waitFor(() => {
				expect(resolveSongB).toBeDefined();
			});

			// Resolve SongA's stale request with value 99 (should be ignored)
			resolveSongA!(99);

			// Resolve SongB's request with value 50 (should be applied)
			resolveSongB!(50);

			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				// SongB should get 50, not the stale 99 from SongA
				expect(props?.simfile?.display_id).toBe(50);
			});
		});

		it('does not show error banner when stale get-next-display-id request rejects after user switches songs', async () => {
			authState = { ...authState, isAuthenticated: true };
			let rejectSongA: ((reason: unknown) => void) | undefined;
			let resolveSongB: ((value: number) => void) | undefined;
			const invokeMock = mockHostInvoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') {
						if (rejectSongA === undefined) {
							return new Promise<number>((_resolve, reject) => {
								rejectSongA = reject;
							});
						}
						return new Promise<number>((resolve) => {
							resolveSongB = resolve;
						});
					}
					return { files: [] };
				});
			}

			const songA = makeNode('SongA', '/test/SongA');
			const { rerender } = render(SongDetails, { props: { song: songA } });

			// Wait for SongA's get-next-display-id IPC to start
			await waitFor(() => {
				expect(rejectSongA).toBeDefined();
			});

			// Switch to SongB while SongA's request is still in-flight
			const songB = makeNode('SongB', '/test/SongB');
			await rerender({ props: { song: songB } });

			// Wait for SongB's get-next-display-id IPC to start
			await waitFor(() => {
				expect(resolveSongB).toBeDefined();
			});

			// Reject SongA's stale request (should NOT set error on SongB)
			rejectSongA!(new Error('Network error'));

			// Resolve SongB's request with value 50
			resolveSongB!(50);

			await waitFor(() => {
				const props = getLastProps<ChartDetailTestProps>(vi.mocked(ChartDetail));
				expect(props?.simfile?.display_id).toBe(50);
			});

			// No error banner should be visible for SongB
			expect(screen.queryByText(/Could not fetch the next display ID/)).toBeNull();
		});
	});
});
