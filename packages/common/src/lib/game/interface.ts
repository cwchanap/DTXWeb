export interface LaneConfig {
	name: string;
	noteColor: number;
	id: string;
	playable: boolean;
	iconFrameIndex?: number;
	width?: number;
}

export enum AssetName {
	LANE_ICONS = 'lane-icons',
	DRUM_CHIPS = 'drum-chips'
}
