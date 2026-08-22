export type LocalSongAction = {
	kind: 'create' | 'update' | 'drive';
};

type SongIdentity = {
	path?: string | null;
	name?: string | null;
	linkedSimFileId?: string | null;
};

export const getPrimaryOutcomeKey = (song: SongIdentity, workspacePath: string): string =>
	`workspace:${workspacePath}${String.fromCharCode(0)}song:${song.path || song.name}`;

export const getLocalSongActionKey = (song: SongIdentity, workspacePath: string): string => {
	if (song.linkedSimFileId) return `simfile:${song.linkedSimFileId}`;
	return getPrimaryOutcomeKey(song, workspacePath);
};

export const withoutMapKey = <T>(source: Map<string, T>, key: string): Map<string, T> => {
	const next = new Map(source);
	next.delete(key);
	return next;
};

export const beginLocalSongAction = (
	actions: Map<string, LocalSongAction>,
	key: string,
	kind: LocalSongAction['kind']
): { actions: Map<string, LocalSongAction>; action: LocalSongAction } | null => {
	if (actions.has(key)) return null;
	const action: LocalSongAction = { kind };
	const nextActions = new Map(actions).set(key, action);
	return { actions: nextActions, action };
};

export const finishLocalSongAction = (
	actions: Map<string, LocalSongAction>,
	key: string,
	action: LocalSongAction
): Map<string, LocalSongAction> => {
	if (actions.get(key) !== action) return actions;
	const nextActions = new Map(actions);
	nextActions.delete(key);
	return nextActions;
};

export const isSelectionCurrent = (params: {
	generation: number;
	token: number;
	currentPath: string;
	targetPath: string;
}): boolean => params.generation === params.token && params.currentPath === params.targetPath;
