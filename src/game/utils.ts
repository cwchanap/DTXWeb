import { PUBLIC_SKIN_BUCKET_URL } from '$env/static/public';
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

	// Check if we're in production environment
	const isProd = import.meta.env.PROD;

	const baseUrl = isProd ? PUBLIC_SKIN_BUCKET_URL : '/skin';

	return `${baseUrl}/${assetsMap[assetName]}`;
}
