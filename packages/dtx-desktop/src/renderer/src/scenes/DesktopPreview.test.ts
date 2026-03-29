import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the parent Preview class and AssetName from common
vi.mock('@dtx/common/game', () => {
	const MockPreview = class {
		textures = {
			addSpriteSheet: vi.fn(),
			addImage: vi.fn()
		};

		async create() {}
		preload() {}
	};

	return {
		Preview: MockPreview,
		AssetName: {
			LANE_ICONS: 'lane_icons',
			DRUM_CHIPS: 'drum_chips'
		}
	};
});

import { DesktopPreview } from './DesktopPreview';

// Helper to create a mock Image that triggers onload on src assignment
const createSuccessImage = () => {
	const img: {
		onload: (() => void) | null;
		onerror: ((err: unknown) => void) | null;
		_src: string;
		src: string;
	} = {
		onload: null,
		onerror: null,
		_src: '',
		get src() {
			return this._src;
		},
		set src(value: string) {
			this._src = value;
			Promise.resolve().then(() => {
				if (this.onload) this.onload();
			});
		}
	};
	return img;
};

const createErrorImage = (error: unknown = new Error('load failed')) => {
	const img: {
		onload: (() => void) | null;
		onerror: ((err: unknown) => void) | null;
		_src: string;
		src: string;
	} = {
		onload: null,
		onerror: null,
		_src: '',
		get src() {
			return this._src;
		},
		set src(value: string) {
			this._src = value;
			Promise.resolve().then(() => {
				if (this.onerror) this.onerror(error);
			});
		}
	};
	return img;
};

describe('DesktopPreview', () => {
	let scene: DesktopPreview;
	let mockInvoke: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockInvoke = vi.fn();

		// Mock window.electron
		Object.defineProperty(window, 'electron', {
			value: { ipcRenderer: { invoke: mockInvoke } },
			writable: true,
			configurable: true
		});

		// Default Image mock: triggers onload
		vi.spyOn(global, 'Image').mockImplementation(
			() => createSuccessImage() as unknown as HTMLImageElement
		);

		scene = new DesktopPreview();
	});

	it('has static key "Preview"', () => {
		expect(DesktopPreview.key).toBe('Preview');
	});

	it('preload() runs without throwing', () => {
		expect(() => scene.preload()).not.toThrow();
	});

	it('create() invokes get-skin-asset for lane icons and drum chips', async () => {
		mockInvoke.mockResolvedValue({ success: true, dataUrl: 'data:image/png;base64,abc' });

		await scene.create();

		expect(mockInvoke).toHaveBeenCalledWith('get-skin-asset', 'default/Graphics/7_pads.png');
		expect(mockInvoke).toHaveBeenCalledWith(
			'get-skin-asset',
			'default/Graphics/7_chips_drums.png'
		);
	});

	it('create() adds spritesheet texture when lane icons load successfully', async () => {
		mockInvoke.mockResolvedValue({ success: true, dataUrl: 'data:image/png;base64,abc' });

		await scene.create();

		expect(
			(scene as unknown as { textures: { addSpriteSheet: ReturnType<typeof vi.fn> } })
				.textures.addSpriteSheet
		).toHaveBeenCalledWith('lane_icons', expect.anything(), {
			frameWidth: 96,
			frameHeight: 96
		});
	});

	it('create() adds image texture when drum chips load successfully', async () => {
		mockInvoke.mockResolvedValue({ success: true, dataUrl: 'data:image/png;base64,abc' });

		await scene.create();

		expect(
			(scene as unknown as { textures: { addImage: ReturnType<typeof vi.fn> } }).textures
				.addImage
		).toHaveBeenCalledWith('drum_chips', expect.anything());
	});

	it('create() logs warning but does not throw when lane icons fail to load (success:false)', async () => {
		mockInvoke
			.mockResolvedValueOnce({ success: false, error: 'Not found' })
			.mockResolvedValueOnce({ success: false, error: 'Not found' });

		await expect(scene.create()).resolves.not.toThrow();
	});

	it('create() logs warning but does not throw when drum chips fail to load (success:false)', async () => {
		mockInvoke
			.mockResolvedValueOnce({ success: true, dataUrl: 'data:image/png;base64,abc' })
			.mockResolvedValueOnce({ success: false, error: 'Not found' });

		await expect(scene.create()).resolves.not.toThrow();
	});

	it('create() throws when IPC invoke rejects', async () => {
		mockInvoke.mockRejectedValue(new Error('IPC error'));

		await expect(scene.create()).rejects.toThrow('IPC error');
	});

	it('createTextureFromDataUrl rejects when Image fails to load', async () => {
		// Override Image mock to trigger onerror
		vi.spyOn(global, 'Image').mockImplementation(
			() => createErrorImage(new Error('img error')) as unknown as HTMLImageElement
		);

		mockInvoke
			.mockResolvedValueOnce({ success: true, dataUrl: 'data:image/png;base64,abc' })
			.mockResolvedValueOnce({ success: false, error: 'skip' });

		await expect(scene.create()).rejects.toThrow('img error');
	});
});
