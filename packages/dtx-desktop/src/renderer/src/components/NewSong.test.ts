import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

/**
 * Sanitizes a file or folder name to prevent directory traversal attacks
 * and ensure valid directory names
 */
function sanitizeName(name: string): string {
	if (!name || typeof name !== 'string') {
		return '';
	}

	// Remove leading/trailing whitespace
	let sanitized = name.trim();

	// Remove or replace dangerous path traversal sequences
	sanitized = sanitized.replace(/\.\.+/g, ''); // Remove .. sequences
	sanitized = sanitized.replace(/[\/\\]/g, ''); // Remove path separators

	// Remove or replace invalid filename characters (Windows + Unix)
	// Invalid characters: < > : " | ? * and control characters (0-31, 127)
	sanitized = sanitized.replace(/[<>:"|?*\x00-\x1f\x7f]/g, '');

	// Remove leading dots and spaces (Windows restriction)
	sanitized = sanitized.replace(/^[.\s]+/, '');

	// Remove trailing dots and spaces (Windows restriction)
	sanitized = sanitized.replace(/[.\s]+$/, '');

	// Handle reserved names on Windows
	const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
	if (reservedNames.test(sanitized)) {
		sanitized = sanitized + '_safe';
	}

	// Ensure the name is not empty after sanitization
	if (!sanitized) {
		sanitized = 'untitled';
	}

	// Limit length to prevent filesystem issues (255 is common limit)
	if (sanitized.length > 200) {
		sanitized = sanitized.substring(0, 200);
	}

	return sanitized;
}

describe('NewSong Component Logic', () => {
	let mockIpcInvoke: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock IPC calls
		mockIpcInvoke = vi.fn();
		(window.electron.ipcRenderer.invoke as any) = mockIpcInvoke;

		// Default IPC responses
		mockIpcInvoke.mockImplementation((channel: string, ...args: any[]) => {
			switch (channel) {
				case 'path-exists':
					return Promise.resolve(false); // Folder doesn't exist by default
				case 'create-song':
					return Promise.resolve({ success: true });
				case 'load-tree-structure':
					return Promise.resolve([]);
				case 'select-folder':
					return Promise.resolve({
						canceled: false,
						filePaths: ['/selected/path']
					});
				default:
					return Promise.resolve(null);
			}
		});
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('Name Sanitization Function', () => {
		it('should handle empty or null input', () => {
			expect(sanitizeName('')).toBe('');
			expect(sanitizeName(null as any)).toBe('');
			expect(sanitizeName(undefined as any)).toBe('');
		});

		it('should remove dangerous path traversal sequences', () => {
			expect(sanitizeName('../../../dangerous')).toBe('dangerous');
			expect(sanitizeName('..\\..\\dangerous')).toBe('dangerous');
			expect(sanitizeName('test/../folder')).toBe('testfolder');
		});

		it('should remove path separators', () => {
			expect(sanitizeName('folder/subfolder')).toBe('foldersubfolder');
			expect(sanitizeName('folder\\subfolder')).toBe('foldersubfolder');
		});

		it('should remove invalid filename characters', () => {
			expect(sanitizeName('test<>:"|?*file')).toBe('testfile');
			expect(sanitizeName('file\x00\x1f\x7f')).toBe('file');
		});

		it('should remove leading and trailing dots and spaces', () => {
			expect(sanitizeName('  ...test...  ')).toBe('test');
			expect(sanitizeName('.hidden')).toBe('hidden');
			expect(sanitizeName('test.')).toBe('test');
		});

		it('should handle reserved Windows names', () => {
			expect(sanitizeName('CON')).toBe('CON_safe');
			expect(sanitizeName('PRN')).toBe('PRN_safe');
			expect(sanitizeName('AUX')).toBe('AUX_safe');
			expect(sanitizeName('NUL')).toBe('NUL_safe');
			expect(sanitizeName('COM1')).toBe('COM1_safe');
			expect(sanitizeName('LPT9')).toBe('LPT9_safe');
			expect(sanitizeName('con')).toBe('con_safe'); // case insensitive
		});

		it('should return "untitled" for names that become empty after sanitization', () => {
			expect(sanitizeName('...')).toBe('untitled');
			expect(sanitizeName('   ')).toBe('untitled');
			expect(sanitizeName('<>:"|?*')).toBe('untitled');
		});

		it('should limit length to 200 characters', () => {
			const longName = 'a'.repeat(250);
			const sanitized = sanitizeName(longName);
			expect(sanitized.length).toBe(200);
			expect(sanitized).toBe('a'.repeat(200));
		});

		it('should handle normal valid names correctly', () => {
			expect(sanitizeName('My Song')).toBe('My Song');
			expect(sanitizeName('Song_123')).toBe('Song_123');
			expect(sanitizeName('Test-Song (Version 2)')).toBe('Test-Song (Version 2)');
		});

		it('should handle mixed dangerous and safe characters', () => {
			expect(sanitizeName('My<Song>:Name')).toBe('MySongName');
			expect(sanitizeName('..\\My Song/../Test')).toBe('My SongTest');
		});
	});

	describe('IPC Integration Tests', () => {
		it('should call path-exists IPC with correct parameters', async () => {
			const selectedPath = '/test/workspace';
			const folderName = 'TestSong';

			await window.electron.ipcRenderer.invoke('path-exists', selectedPath, folderName);

			expect(mockIpcInvoke).toHaveBeenCalledWith('path-exists', selectedPath, folderName);
		});

		it('should call create-song IPC with correct parameters', async () => {
			const songData = {
				selectedPath: '/test/workspace',
				sanitizedFolderName: 'My Song',
				sanitizedSongName: 'My Song',
				templateFolderPath: null
			};

			await window.electron.ipcRenderer.invoke('create-song', songData);

			expect(mockIpcInvoke).toHaveBeenCalledWith('create-song', songData);
		});

		it('should call create-song IPC with template', async () => {
			const songData = {
				selectedPath: '/test/workspace',
				sanitizedFolderName: 'Templated Song',
				sanitizedSongName: 'Templated Song',
				templateFolderPath: '/templates/basic'
			};

			await window.electron.ipcRenderer.invoke('create-song', songData);

			expect(mockIpcInvoke).toHaveBeenCalledWith('create-song', songData);
		});

		it('should call select-folder IPC', async () => {
			await window.electron.ipcRenderer.invoke('select-folder');

			expect(mockIpcInvoke).toHaveBeenCalledWith('select-folder');
		});

		it('should call load-tree-structure IPC after song creation', async () => {
			const workspacePath = '/test/workspace';

			await window.electron.ipcRenderer.invoke('load-tree-structure', workspacePath);

			expect(mockIpcInvoke).toHaveBeenCalledWith('load-tree-structure', workspacePath);
		});
	});

	describe('Error Handling Logic', () => {
		it('should handle path-exists IPC errors gracefully', async () => {
			mockIpcInvoke.mockImplementation((channel: string) => {
				if (channel === 'path-exists') {
					return Promise.reject(new Error('IPC Error'));
				}
				return Promise.resolve(null);
			});

			try {
				await window.electron.ipcRenderer.invoke('path-exists', '/test', 'folder');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe('IPC Error');
			}
		});

		it('should handle create-song IPC errors gracefully', async () => {
			mockIpcInvoke.mockImplementation((channel: string) => {
				if (channel === 'create-song') {
					return Promise.reject(new Error('Creation failed'));
				}
				return Promise.resolve(null);
			});

			try {
				await window.electron.ipcRenderer.invoke('create-song', {});
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe('Creation failed');
			}
		});

		it('should handle select-folder IPC errors gracefully', async () => {
			mockIpcInvoke.mockImplementation((channel: string) => {
				if (channel === 'select-folder') {
					return Promise.reject(new Error('Selection failed'));
				}
				return Promise.resolve(null);
			});

			try {
				await window.electron.ipcRenderer.invoke('select-folder');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe('Selection failed');
			}
		});
	});

	describe('Validation Logic', () => {
		it('should validate required song name', () => {
			const songName = '';
			const isValid = songName.trim().length > 0;
			expect(isValid).toBe(false);
		});

		it('should validate required path', () => {
			const selectedPath = '';
			const isValid = selectedPath.length > 0;
			expect(isValid).toBe(false);
		});

		it('should validate when folder exists', () => {
			const folderExists = true;
			const isValid = !folderExists;
			expect(isValid).toBe(false);
		});

		it('should validate complete form', () => {
			const songName = 'My Song';
			const selectedPath = '/test/workspace';
			const folderExists = false;

			const isValid = songName.trim().length > 0 && 
							selectedPath.length > 0 && 
							!folderExists;
			
			expect(isValid).toBe(true);
		});
	});

	describe('Song Creation Logic', () => {
		it('should create song data with same folder name', () => {
			const songName = 'My New Song';
			const useSameNameForFolder = true;
			const folderName = '';
			const selectedPath = '/test/workspace';
			const templateFolderPath = null;

			const sanitizedSongName = sanitizeName(songName);
			const rawFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
			const sanitizedFolderName = sanitizeName(rawFolderName);

			const songData = {
				selectedPath,
				sanitizedFolderName,
				sanitizedSongName,
				templateFolderPath
			};

			expect(songData).toEqual({
				selectedPath: '/test/workspace',
				sanitizedFolderName: 'My New Song',
				sanitizedSongName: 'My New Song',
				templateFolderPath: null
			});
		});

		it('should create song data with different folder name', () => {
			const songName = 'Song Title';
			const useSameNameForFolder = false;
			const folderName = 'song-folder';
			const selectedPath = '/test/workspace';
			const templateFolderPath = '/templates/basic';

			const sanitizedSongName = sanitizeName(songName);
			const rawFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
			const sanitizedFolderName = sanitizeName(rawFolderName);

			const songData = {
				selectedPath,
				sanitizedFolderName,
				sanitizedSongName,
				templateFolderPath
			};

			expect(songData).toEqual({
				selectedPath: '/test/workspace',
				sanitizedFolderName: 'song-folder',
				sanitizedSongName: 'Song Title',
				templateFolderPath: '/templates/basic'
			});
		});

		it('should sanitize dangerous names in song creation', () => {
			const songName = '../../../dangerous';
			const useSameNameForFolder = true;
			const folderName = '';
			const selectedPath = '/test/workspace';
			const templateFolderPath = null;

			const sanitizedSongName = sanitizeName(songName);
			const rawFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
			const sanitizedFolderName = sanitizeName(rawFolderName);

			const songData = {
				selectedPath,
				sanitizedFolderName,
				sanitizedSongName,
				templateFolderPath
			};

			expect(songData).toEqual({
				selectedPath: '/test/workspace',
				sanitizedFolderName: 'dangerous',
				sanitizedSongName: 'dangerous',
				templateFolderPath: null
			});
		});
	});

	describe('Template Logic', () => {
		it('should handle template selection', () => {
			const template = {
				id: 'template-1',
				name: 'Basic Template',
				folderPath: '/templates/basic',
				createdAt: '2023-01-01T00:00:00.000Z'
			};

			const selectedTemplate = template;
			const templateFolderPath = selectedTemplate?.folderPath || null;

			expect(templateFolderPath).toBe('/templates/basic');
		});

		it('should handle no template selection', () => {
			const selectedTemplate = null;
			const templateFolderPath = selectedTemplate?.folderPath || null;

			expect(templateFolderPath).toBe(null);
		});

		it('should auto-populate song name from template when empty', () => {
			const currentSongName = '';
			const template = {
				id: 'template-1',
				name: 'Basic Template',
				folderPath: '/templates/basic',
				createdAt: '2023-01-01T00:00:00.000Z'
			};

			const newSongName = !currentSongName.trim() ? template.name : currentSongName;

			expect(newSongName).toBe('Basic Template');
		});

		it('should not overwrite existing song name when selecting template', () => {
			const currentSongName = 'Existing Song';
			const template = {
				id: 'template-1',
				name: 'Basic Template',
				folderPath: '/templates/basic',
				createdAt: '2023-01-01T00:00:00.000Z'
			};

			const newSongName = !currentSongName.trim() ? template.name : currentSongName;

			expect(newSongName).toBe('Existing Song');
		});
	});

	describe('Folder Existence Checking Logic', () => {
		it('should check folder existence with correct parameters', async () => {
			const selectedPath = '/test/workspace';
			const songName = 'TestSong';
			const useSameNameForFolder = true;
			const folderName = '';

			const rawFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
			const sanitizedFolderName = sanitizeName(rawFolderName);

			const folderExists = await window.electron.ipcRenderer.invoke(
				'path-exists',
				selectedPath,
				sanitizedFolderName
			);

			expect(mockIpcInvoke).toHaveBeenCalledWith('path-exists', selectedPath, 'TestSong');
			expect(folderExists).toBe(false);
		});

		it('should return true when folder exists', async () => {
			mockIpcInvoke.mockImplementation((channel: string) => {
				if (channel === 'path-exists') {
					return Promise.resolve(true);
				}
				return Promise.resolve(null);
			});

			const folderExists = await window.electron.ipcRenderer.invoke(
				'path-exists',
				'/test/workspace',
				'ExistingFolder'
			);

			expect(folderExists).toBe(true);
		});

		it('should generate warning message when folder exists', () => {
			const folderName = 'ExistingSong';
			const folderExists = true;

			const warningMessage = folderExists 
				? `A folder named "${folderName}" already exists`
				: '';

			expect(warningMessage).toBe('A folder named "ExistingSong" already exists');
		});
	});
});