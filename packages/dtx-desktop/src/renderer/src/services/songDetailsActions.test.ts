import { describe, it, expect } from 'vitest';
import {
	getPrimaryOutcomeKey,
	getLocalSongActionKey,
	withoutMapKey,
	beginLocalSongAction,
	finishLocalSongAction,
	isSelectionCurrent,
	type LocalSongAction
} from './songDetailsActions';

const nulByte = String.fromCharCode(0);

describe('getPrimaryOutcomeKey', () => {
	it('keys by workspace path and song path, separated by a NUL byte', () => {
		const key = getPrimaryOutcomeKey({ path: '/ws/song', name: 'song' }, '/ws');
		expect(key).toBe(`workspace:/ws${nulByte}song:/ws/song`);
	});

	it('falls back to song name when path is missing', () => {
		const key = getPrimaryOutcomeKey({ path: '', name: 'song' }, '/ws');
		expect(key).toBe(`workspace:/ws${nulByte}song:song`);
	});
});

describe('getLocalSongActionKey', () => {
	it('keys by linked simfile id when the song is linked', () => {
		const key = getLocalSongActionKey(
			{ path: '/ws/song', name: 'song', linkedSimFileId: '42' },
			'/ws'
		);
		expect(key).toBe('simfile:42');
	});

	it('falls back to the primary outcome key when unlinked', () => {
		const key = getLocalSongActionKey({ path: '/ws/song', name: 'song' }, '/ws');
		expect(key).toBe(getPrimaryOutcomeKey({ path: '/ws/song', name: 'song' }, '/ws'));
	});
});

describe('withoutMapKey', () => {
	it('returns a new map without the given key', () => {
		const source = new Map([
			['a', 1],
			['b', 2]
		]);
		const result = withoutMapKey(source, 'a');
		expect([...result.entries()]).toEqual([['b', 2]]);
		expect(source.has('a')).toBe(true);
	});

	it('is a no-op value-wise when the key is absent', () => {
		const source = new Map([['a', 1]]);
		const result = withoutMapKey(source, 'missing');
		expect([...result.entries()]).toEqual([['a', 1]]);
		expect(result).not.toBe(source);
	});
});

describe('beginLocalSongAction', () => {
	it('locks a fresh key and returns a new map plus the action', () => {
		const actions = new Map<string, LocalSongAction>();
		const result = beginLocalSongAction(actions, 'song-a', 'create');
		expect(result).not.toBeNull();
		expect(result?.action).toEqual({ kind: 'create' });
		expect(result?.actions.get('song-a')).toBe(result?.action);
		expect(actions.size).toBe(0);
	});

	it('refuses a second concurrent action for the same key', () => {
		const actions = new Map<string, LocalSongAction>();
		const first = beginLocalSongAction(actions, 'song-a', 'create');
		const second = beginLocalSongAction(first!.actions, 'song-a', 'update');
		expect(second).toBeNull();
	});

	it('allows a concurrent action for a different key', () => {
		const actions = new Map<string, LocalSongAction>();
		const first = beginLocalSongAction(actions, 'song-a', 'create');
		const second = beginLocalSongAction(first!.actions, 'song-b', 'create');
		expect(second).not.toBeNull();
		expect(second?.actions.get('song-a')).toBe(first?.action);
		expect(second?.actions.get('song-b')).toBe(second?.action);
	});
});

describe('finishLocalSongAction', () => {
	it('removes the key when the action reference matches', () => {
		const actions = new Map<string, LocalSongAction>();
		const begun = beginLocalSongAction(actions, 'song-a', 'update')!;
		const result = finishLocalSongAction(begun.actions, 'song-a', begun.action);
		expect(result.has('song-a')).toBe(false);
	});

	it('is a no-op when a stale finish races a newer action for the same key', () => {
		const actions = new Map<string, LocalSongAction>();
		const staleBegun = beginLocalSongAction(actions, 'song-a', 'update')!;
		const finished = finishLocalSongAction(staleBegun.actions, 'song-a', staleBegun.action);
		const newerBegun = beginLocalSongAction(finished, 'song-a', 'drive')!;

		const staleFinishResult = finishLocalSongAction(
			newerBegun.actions,
			'song-a',
			staleBegun.action
		);

		expect(staleFinishResult).toBe(newerBegun.actions);
		expect(staleFinishResult.get('song-a')).toBe(newerBegun.action);
	});

	it('is a no-op when the key was never present', () => {
		const actions = new Map<string, LocalSongAction>();
		const result = finishLocalSongAction(actions, 'song-a', { kind: 'create' });
		expect(result).toBe(actions);
	});
});

describe('isSelectionCurrent', () => {
	it('is true when generation matches the token and paths match', () => {
		expect(
			isSelectionCurrent({
				generation: 1,
				token: 1,
				currentPath: '/ws/song',
				targetPath: '/ws/song'
			})
		).toBe(true);
	});

	it('is false once the generation has advanced past the token', () => {
		expect(
			isSelectionCurrent({
				generation: 2,
				token: 1,
				currentPath: '/ws/song',
				targetPath: '/ws/song'
			})
		).toBe(false);
	});

	it('is false once the selected path diverges from the target path', () => {
		expect(
			isSelectionCurrent({
				generation: 1,
				token: 1,
				currentPath: '/ws/other-song',
				targetPath: '/ws/song'
			})
		).toBe(false);
	});
});
