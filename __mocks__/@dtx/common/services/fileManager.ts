import { vi } from 'vitest';

export const fileManager = {
	generateKey: vi.fn(
		(simfileId: string | null, fileName: string) => `${simfileId || 'local'}:${fileName}`
	),
	getFile: vi.fn(),
	setFile: vi.fn(),
	removeFile: vi.fn().mockReturnValue(true),
	getKeys: vi.fn().mockReturnValue([]),
	clear: vi.fn()
};

export const generateKey = fileManager.generateKey;
export const getFile = fileManager.getFile;
export const setFile = fileManager.setFile;
export const removeFile = fileManager.removeFile;
export const getKeys = fileManager.getKeys;
export const clear = fileManager.clear;
