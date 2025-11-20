import { Preview, AssetName } from '@dtx/common/game';

type SkinAssetResult = {
	success: boolean;
	dataUrl?: string;
	error?: string;
};

export class DesktopPreview extends Preview {
	static key = 'Preview'; // Use same key as parent to match Editor expectations

	constructor() {
		super();
	}

	preload() {
		// Desktop environment - no preloading needed here
		// Assets will be loaded in create() method
	}

	async create() {
		// Load desktop assets first
		await this.loadDesktopAssets();

		// Call parent create method
		await super.create();
	}

	private async loadDesktopAssets() {
		try {
			const invokeSkinAsset = (assetPath: string) =>
				(
					window as typeof window & {
						electron: {
							ipcRenderer: {
								invoke: (
									channel: string,
									...args: unknown[]
								) => Promise<SkinAssetResult>;
							};
						};
					}
				).electron.ipcRenderer.invoke('get-skin-asset', assetPath);

			// Load lane icons spritesheet
			const laneIconsResult = await invokeSkinAsset('default/Graphics/7_pads.png');

			if (laneIconsResult.success) {
				await this.createTextureFromDataUrl(AssetName.LANE_ICONS, laneIconsResult.dataUrl, {
					frameWidth: 96,
					frameHeight: 96
				});
			} else {
				console.warn('Failed to load lane icons:', laneIconsResult.error);
			}

			// Load drum chips image
			const drumChipsResult = await invokeSkinAsset('default/Graphics/7_chips_drums.png');

			if (drumChipsResult.success) {
				await this.createTextureFromDataUrl(AssetName.DRUM_CHIPS, drumChipsResult.dataUrl);
			} else {
				console.warn('Failed to load drum chips:', drumChipsResult.error);
			}
		} catch (error) {
			console.error('Error loading desktop assets:', error);
			throw error;
		}
	}

	private async createTextureFromDataUrl(
		key: string,
		dataUrl: string,
		spriteConfig?: { frameWidth: number; frameHeight: number }
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				if (spriteConfig) {
					// Create spritesheet texture
					this.textures.addSpriteSheet(key, img, spriteConfig);
				} else {
					// Create regular texture
					this.textures.addImage(key, img);
				}
				resolve();
			};
			img.onerror = (error) => {
				console.error(`Failed to load image for texture "${key}":`, error);
				reject(error);
			};
			img.src = dataUrl;
		});
	}
}
