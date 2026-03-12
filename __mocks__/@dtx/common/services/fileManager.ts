import { vi } from 'vitest';

const mockFileManager = {
	generateKey: vi.fn(
		(simfileId: string | null, fileName: string) => `${simfileId || 'local'}:${fileName}`
	),
	getFile: vi.fn(),
	setFile: vi.fn(),
	removeFile: vi.fn().mockReturnValue(true),
	getKeys: vi.fn().mockReturnValue([]),
	clear: vi.fn()
};

export const generateKey = mockFileManager.generateKey;
export const getFile = mockFileManager.getFile;
export const setFile = mockFileManager.setFile;
export const removeFile = mockFileManager.removeFile;
export const getKeys = mockFileManager.getKeys;
export const clear = mockFileManager.clear;
