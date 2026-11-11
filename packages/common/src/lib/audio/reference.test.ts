import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeAudioReference } from './reference';

describe('normalizeAudioReference', () => {
	it.each<[string, string | null]>([
		['kick.wav', 'kick.wav'],
		['drums/cymbal.wav', 'drums/cymbal.wav'],
		['drums\\cymbal.wav', 'drums/cymbal.wav'],
		['a\\b\\c.wav', 'a/b/c.wav'],
		['sub dir/snare#1.wav', 'sub dir/snare#1.wav'],
		['', null],
		['.', null],
		['..', null],
		['./kick.wav', null],
		['../kick.wav', null],
		['..\\kick.wav', null],
		['a/./b.wav', null],
		['a/../b.wav', null],
		['a//b.wav', null],
		['//share/kick.wav', null],
		['/kick.wav', null],
		['/etc/passwd', null]
	])('maps %s to %s', (ref, expected) => {
		expect(normalizeAudioReference(ref)).toBe(expected);
	});
});

describe('@dtx/common main barrel', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('exports normalizeAudioReference without constructing an AudioContext', async () => {
		vi.resetModules();
		const construct = vi.fn();
		vi.stubGlobal(
			'AudioContext',
			class {
				constructor() {
					construct();
				}
			}
		);
		const mod = await import('../index');
		expect(mod.normalizeAudioReference).toBeTypeOf('function');
		expect(mod.normalizeAudioReference('a\\b.wav')).toBe('a/b.wav');
		expect(construct).not.toHaveBeenCalled();
	});
});
