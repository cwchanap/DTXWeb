import { describe, it, expect } from 'vitest';
import { getAssetPath } from './utils';
import { AssetName } from './interface';

describe('utils', () => {
	describe('getAssetPath', () => {
		it('should return correct path for LANE_ICONS asset', () => {
			const result = getAssetPath(AssetName.LANE_ICONS);
			expect(result).toBe('/skin/default/Graphics/7_pads.png');
		});

		it('should return correct path for DRUM_CHIPS asset', () => {
			const result = getAssetPath(AssetName.DRUM_CHIPS);
			expect(result).toBe('/skin/default/Graphics/7_chips_drums.png');
		});

		it('should handle all defined asset names', () => {
			// Test that all AssetName enum values are handled
			const assetNames = Object.values(AssetName);

			assetNames.forEach((assetName) => {
				const result = getAssetPath(assetName);

				// Should return a string starting with /skin/
				expect(typeof result).toBe('string');
				expect(result).toMatch(/^\/skin\//);

				// Should contain the expected file extension
				expect(result).toMatch(/\.png$/);
			});
		});

		it('should return consistent paths for the same asset', () => {
			const path1 = getAssetPath(AssetName.LANE_ICONS);
			const path2 = getAssetPath(AssetName.LANE_ICONS);

			expect(path1).toBe(path2);
		});

		it('should return different paths for different assets', () => {
			const laneIconsPath = getAssetPath(AssetName.LANE_ICONS);
			const drumChipsPath = getAssetPath(AssetName.DRUM_CHIPS);

			expect(laneIconsPath).not.toBe(drumChipsPath);
		});

		it('should return paths in the expected format', () => {
			const assetNames = Object.values(AssetName);

			assetNames.forEach((assetName) => {
				const result = getAssetPath(assetName);

				// Should start with /skin/
				expect(result).toMatch(/^\/skin\//);

				// Should contain default directory
				expect(result).toContain('default/');

				// Should contain Graphics directory
				expect(result).toContain('Graphics/');

				// Should end with .png
				expect(result).toMatch(/\.png$/);

				// Should not contain double slashes
				expect(result).not.toContain('//');
			});
		});

		it('should handle asset name case sensitivity correctly', () => {
			// AssetName enum values should be exact matches
			const laneIconsPath = getAssetPath(AssetName.LANE_ICONS);
			expect(laneIconsPath).toBeDefined();
			expect(typeof laneIconsPath).toBe('string');
		});

		describe('path structure validation', () => {
			it('should return paths with correct directory structure', () => {
				const laneIconsPath = getAssetPath(AssetName.LANE_ICONS);
				const drumChipsPath = getAssetPath(AssetName.DRUM_CHIPS);

				// Both should follow the same structure pattern
				const expectedPattern = /^\/skin\/default\/Graphics\/[\w_]+\.png$/;

				expect(laneIconsPath).toMatch(expectedPattern);
				expect(drumChipsPath).toMatch(expectedPattern);
			});

			it('should return valid file names', () => {
				const assetNames = Object.values(AssetName);

				assetNames.forEach((assetName) => {
					const result = getAssetPath(assetName);
					const fileName = result.split('/').pop();

					// File name should not be empty
					expect(fileName).toBeTruthy();

					// File name should end with .png
					expect(fileName).toMatch(/\.png$/);

					// File name should contain valid characters only
					expect(fileName).toMatch(/^[\w_.]+$/);
				});
			});
		});

		describe('assets map coverage', () => {
			it('should have mapping for all AssetName enum values', () => {
				const assetNames = Object.values(AssetName);

				// Every AssetName enum value should return a valid path
				assetNames.forEach((assetName) => {
					expect(() => getAssetPath(assetName)).not.toThrow();

					const result = getAssetPath(assetName);
					expect(result).toBeTruthy();
					expect(typeof result).toBe('string');
					expect(result.length).toBeGreaterThan(0);
				});
			});

			it('should not return undefined for any valid asset name', () => {
				const assetNames = Object.values(AssetName);

				assetNames.forEach((assetName) => {
					const result = getAssetPath(assetName);
					expect(result).not.toBeUndefined();
					expect(result).not.toBeNull();
				});
			});
		});

		describe('return value properties', () => {
			it('should return absolute paths', () => {
				const assetNames = Object.values(AssetName);

				assetNames.forEach((assetName) => {
					const result = getAssetPath(assetName);

					// Should start with / indicating absolute path
					expect(result.charAt(0)).toBe('/');
				});
			});

			it('should return URLs safe for web use', () => {
				const assetNames = Object.values(AssetName);

				assetNames.forEach((assetName) => {
					const result = getAssetPath(assetName);

					// Should not contain spaces
					expect(result).not.toContain(' ');

					// Should not contain unsafe URL characters
					expect(result).not.toMatch(/[<>"'`\s]/);

					// Should be a valid URL path component
					expect(() => new URL(result, 'http://example.com')).not.toThrow();
				});
			});
		});

		describe('specific asset paths', () => {
			it('should return expected path for LANE_ICONS', () => {
				const result = getAssetPath(AssetName.LANE_ICONS);

				expect(result).toBe('/skin/default/Graphics/7_pads.png');
				expect(result).toContain('7_pads');
			});

			it('should return expected path for DRUM_CHIPS', () => {
				const result = getAssetPath(AssetName.DRUM_CHIPS);

				expect(result).toBe('/skin/default/Graphics/7_chips_drums.png');
				expect(result).toContain('7_chips_drums');
			});
		});
	});
});
