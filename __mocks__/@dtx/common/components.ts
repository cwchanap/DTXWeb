import { vi } from 'vitest';

// Mock the UploadedAssetFiles component to avoid Svelte file loading issues
export const UploadedAssetFiles = vi.fn().mockImplementation(() => ({
	// Mock component implementation
	uploadSelectedFiles: vi.fn().mockResolvedValue(undefined)
}));
