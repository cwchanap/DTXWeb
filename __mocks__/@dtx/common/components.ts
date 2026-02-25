import { vi } from 'vitest';

export const UploadedAssetFiles = vi.fn().mockImplementation(() => ({
	uploadSelectedFiles: vi.fn().mockResolvedValue(undefined)
}));

export const MainTab = vi.fn();
export const SoundTab = vi.fn();
export const PreviewTab = vi.fn();
