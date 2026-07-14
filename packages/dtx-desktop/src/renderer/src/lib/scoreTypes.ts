export interface ScorePayload {
	isBest: boolean;
	score: number | null;
	achievementRate: number | null;
	rankLabel: string | null;
	fullCombo: boolean;
	cleared: boolean;
	maxCombo: number | null;
	perfect: number | null;
	great: number | null;
	good: number | null;
	poor: number | null;
	miss: number | null;
	performedAt: string | null;
	displayOrder: number | null;
}

export interface LocalChartData {
	difficultyLevel: number;
	difficultyLabel: string;
	drumLevel: number;
	fileHash: string;
	aggregate: { playCount: number; clearCount: number };
	best: ScorePayload | null;
	recent: ScorePayload[];
}

export interface DtxmaniaSong {
	title: string;
	artist: string;
	genre: string;
	charts: LocalChartData[];
}

export interface CloudSong {
	id: string;
	title: string;
	artist: string;
	is_published: boolean;
}
