import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
			LANE_ICONS: 'lane-icons',
			DRUM_CHIPS: 'drum-chips'
		}
	};
});

const mockDesktopHost = vi.hoisted(() => ({
	getSkinAsset: vi.fn()
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

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

	beforeEach(() => {
		vi.clearAllMocks();
		mockDesktopHost.getSkinAsset.mockResolvedValue({
			success: true,
			dataUrl: 'data:image/png;base64,abc'
		});

		// Default Image mock: triggers onload
		vi.spyOn(global, 'Image').mockImplementation(
			() => createSuccessImage() as unknown as HTMLImageElement
		);

		scene = new DesktopPreview();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('has static key "Preview"', () => {
		expect(DesktopPreview.key).toBe('Preview');
	});

	it('preload() runs without throwing', () => {
		expect(() => scene.preload()).not.toThrow();
	});

	it('create() invokes get-skin-asset for lane icons and drum chips', async () => {
		await scene.create();

		expect(mockDesktopHost.getSkinAsset).toHaveBeenCalledWith('default/Graphics/7_pads.png');
		expect(mockDesktopHost.getSkinAsset).toHaveBeenCalledWith(
			'default/Graphics/7_chips_drums.png'
		);
	});

	it('create() adds spritesheet texture when lane icons load successfully', async () => {
		await scene.create();

		expect(
			(scene as unknown as { textures: { addSpriteSheet: ReturnType<typeof vi.fn> } })
				.textures.addSpriteSheet
		).toHaveBeenCalledWith('lane-icons', expect.anything(), {
			frameWidth: 96,
			frameHeight: 96
		});
	});

	it('create() adds image texture when drum chips load successfully', async () => {
		await scene.create();

		expect(
			(scene as unknown as { textures: { addImage: ReturnType<typeof vi.fn> } }).textures
				.addImage
		).toHaveBeenCalledWith('drum-chips', expect.anything());
	});

	it('create() logs warning but does not throw when lane icons fail to load (success:false)', async () => {
		mockDesktopHost.getSkinAsset
			.mockResolvedValueOnce({ success: false, error: 'Not found' })
			.mockResolvedValueOnce({ success: false, error: 'Not found' });

		await expect(scene.create()).resolves.toBeUndefined();
	});

	it('create() logs warning but does not throw when drum chips fail to load (success:false)', async () => {
		mockDesktopHost.getSkinAsset
			.mockResolvedValueOnce({ success: true, dataUrl: 'data:image/png;base64,abc' })
			.mockResolvedValueOnce({ success: false, error: 'Not found' });

		await expect(scene.create()).resolves.toBeUndefined();
	});

	it('create() throws when desktopHost rejects', async () => {
		mockDesktopHost.getSkinAsset.mockRejectedValue(new Error('Host error'));

		await expect(scene.create()).rejects.toThrow('Host error');
	});

	it('createTextureFromDataUrl rejects when Image fails to load', async () => {
		// Override the existing Image spy to trigger onerror instead of onload
		vi.mocked(global.Image).mockImplementation(
			() => createErrorImage(new Error('img error')) as unknown as HTMLImageElement
		);

		mockDesktopHost.getSkinAsset
			.mockResolvedValueOnce({ success: true, dataUrl: 'data:image/png;base64,abc' })
			.mockResolvedValueOnce({ success: false, error: 'skip' });

		await expect(scene.create()).rejects.toThrow('img error');
	});
});
