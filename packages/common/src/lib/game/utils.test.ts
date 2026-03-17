import { describe, it, expect } from 'vitest';
import { getAssetPath } from './utils';
import { AssetName } from './interface';

describe('getAssetPath', () => {
	it('returns correct path for LANE_ICONS', () => {
		const result = getAssetPath(AssetName.LANE_ICONS);
		expect(result).toBe('/skin/default/Graphics/7_pads.png');
	});

	it('returns correct path for DRUM_CHIPS', () => {
		const result = getAssetPath(AssetName.DRUM_CHIPS);
		expect(result).toBe('/skin/default/Graphics/7_chips_drums.png');
	});

	it('returns path with /skin/ prefix', () => {
		const result = getAssetPath(AssetName.LANE_ICONS);
		expect(result.startsWith('/skin/')).toBe(true);
	});

	it('returns undefined-based path for unknown asset names', () => {
		const result = getAssetPath('unknown-asset' as AssetName);
		expect(result).toBe('/skin/undefined');
	});
});
