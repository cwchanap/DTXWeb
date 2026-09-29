import { vi } from 'vitest';

export const UploadedAssetFiles = vi.fn().mockImplementation(function (this: unknown) {
	// ponytail: vitest 4+ constructable-mock rule — mocked as `new`-ed Svelte component
	Object.assign(this, {
		uploadSelectedFiles: vi.fn().mockResolvedValue(undefined)
	});
});

export const ChartDetail = vi.fn();
export const MainTab = vi.fn();
export const SoundTab = vi.fn();
export const PreviewTab = vi.fn();
