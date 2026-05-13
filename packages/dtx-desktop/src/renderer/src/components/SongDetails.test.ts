import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	video_preview_url: '',
	dtx_files: []
});

describe('SongDetails', () => {
	beforeEach(() => {
		workspaceState = { ...initialWorkspaceState };
		workspaceListeners.length = 0;
		authState = { isAuthenticated: false, isLoading: false, user: null, error: null };
		vi.clearAllMocks();
		const invokeMock = window.electron?.ipcRenderer?.invoke;
		if (vi.isMockFunction(invokeMock)) {
			invokeMock.mockResolvedValue({ files: [] });
		}
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
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'list-files',
					'/my/songs/TestSong'
				);
			});
		});

		it('does not invoke list-files IPC when song has no path', () => {
			const song = makeNode('TestSong', '');
			render(SongDetails, { props: { song } });
			expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
				'list-files',
				expect.anything()
			);
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
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'list-files',
					'/test/TestSong'
				);
			});
		});

		it('invokes parse-dtx-files IPC when linked simfile is missing BPM', async () => {
			const song = makeNode('TestSong', '/test/TestSong', {
				linkedSimFile: { ...makeLinkedSimFile(), bpm: undefined as unknown as number },
				linkedSimFileId: '1'
			});
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'parse-dtx-files',
					'/test/TestSong'
				);
			});
		});
	});

	describe('IPC error handling', () => {
		it('handles list-files IPC error gracefully', async () => {
			const invokeMock = window.electron?.ipcRenderer?.invoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockRejectedValueOnce(new Error('IPC error'));
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('handles list-files returning error field', async () => {
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'parse-dtx-files',
					'/test/TestSong'
				);
			});
		});
	});

	describe('parse-dtx-files IPC response handling', () => {
		it('handles successful parse-dtx-files response', async () => {
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
			const invokeMock = window.electron?.ipcRenderer?.invoke;
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
			const invokeMock = window.electron?.ipcRenderer?.invoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') return 42;
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'get-next-display-id'
				);
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
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'list-files',
					'/test/TestSong'
				);
			});
			expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
				'get-next-display-id'
			);
		});

		it('does not invoke get-next-display-id when not authenticated', async () => {
			const song = makeNode('TestSong', '/test/TestSong');
			render(SongDetails, { props: { song } });
			await waitFor(() => {
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'list-files',
					'/test/TestSong'
				);
			});
			expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
				'get-next-display-id'
			);
		});

		it('does not invoke get-next-display-id when song has no path', async () => {
			authState = { ...authState, isAuthenticated: true };
			const song = makeNode('TestSong', '');
			render(SongDetails, { props: { song } });
			// Wait a tick for any async effects
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
				'get-next-display-id'
			);
		});

		it('handles get-next-display-id IPC error gracefully', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = window.electron?.ipcRenderer?.invoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') throw new Error('IPC error');
					return { files: [] };
				});
			}
			const song = makeNode('TestSong', '/test/TestSong');
			expect(() => render(SongDetails, { props: { song } })).not.toThrow();
		});

		it('does not re-trigger get-next-display-id when switching back to a previously populated song', async () => {
			authState = { ...authState, isAuthenticated: true };
			const invokeMock = window.electron?.ipcRenderer?.invoke;
			if (vi.isMockFunction(invokeMock)) {
				invokeMock.mockImplementation(async (channel: string) => {
					if (channel === 'get-next-display-id') return 42;
					return { files: [] };
				});
			}
			const songA = makeNode('SongA', '/test/SongA');
			const { rerender } = render(SongDetails, { props: { song: songA } });

			// Wait for songA's get-next-display-id to fire
			await waitFor(() => {
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'get-next-display-id'
				);
			});
			const callsAfterSongA = invokeMock?.mock.calls.filter(
				(call: string[]) => call[0] === 'get-next-display-id'
			).length;

			// Switch to songB
			const songB = makeNode('SongB', '/test/SongB');
			rerender({ props: { song: songB } });
			await waitFor(() => {
				expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
					'get-next-display-id'
				);
			});
			const callsAfterSongB = invokeMock?.mock.calls.filter(
				(call: string[]) => call[0] === 'get-next-display-id'
			).length;
			expect(callsAfterSongB).toBe(callsAfterSongA + 1);

			// Switch back to songA — should NOT trigger another get-next-display-id
			rerender({ props: { song: songA } });
			await new Promise((resolve) => setTimeout(resolve, 50));
			const callsAfterBackToA = invokeMock?.mock.calls.filter(
				(call: string[]) => call[0] === 'get-next-display-id'
			).length;
			expect(callsAfterBackToA).toBe(callsAfterSongB);
		});
	});
});
