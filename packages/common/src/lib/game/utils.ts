import { AssetName } from './interface';

/**
 * Returns the appropriate asset path based on current environment
 * @param assetPath The relative path to the asset
 * @returns Full path to the asset
 */
export function getAssetPath(assetName: AssetName): string {
	const assetsMap: Record<string, string> = {
		[AssetName.LANE_ICONS]: `default/Graphics/7_pads.png`,
		[AssetName.DRUM_CHIPS]: `default/Graphics/7_chips_drums.png`
	};

	const path = assetsMap[assetName];
	if (!path) {
		throw new Error(`Unknown asset name: ${assetName}`);
	}
	return `/skin/${path}`;
}
