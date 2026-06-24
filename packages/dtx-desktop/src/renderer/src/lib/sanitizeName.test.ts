import { describe, it, expect } from 'vitest';
import { sanitizeName } from './sanitizeName';

describe('sanitizeName', () => {
	it('returns empty string for falsy / non-string input', () => {
		expect(sanitizeName('')).toBe('');
		expect(sanitizeName(null as unknown as string)).toBe('');
		expect(sanitizeName(undefined as unknown as string)).toBe('');
	});

	it('trims surrounding whitespace', () => {
		expect(sanitizeName('  hello  ')).toBe('hello');
	});

	it('strips path-traversal sequences (..) and path separators', () => {
		// Security: these must never reach a filesystem path join.
		expect(sanitizeName('../../etc/passwd')).toBe('etcpasswd');
		expect(sanitizeName('a..\\..b')).toBe('ab');
		expect(sanitizeName('a/b\\c')).toBe('abc');
	});

	it('removes Windows-invalid filename characters', () => {
		expect(sanitizeName('a<b>c:d"e|f?g*h')).toBe('abcdefgh');
	});

	it('removes control characters (0-31 and 127) but keeps normal chars', () => {
		expect(sanitizeName('a\x00b\x07c\x1fd\x7f')).toBe('abcd');
	});

	it('keeps legitimate punctuation that is filesystem-safe', () => {
		expect(sanitizeName('My Song! (v2).')).toBe('My Song! (v2)');
		// trailing dot stripped (Windows restriction), but interior kept
	});

	it('strips leading dots and spaces (Windows restriction)', () => {
		expect(sanitizeName('.hidden')).toBe('hidden');
		expect(sanitizeName('   .name')).toBe('name');
	});

	it('appends _safe to Windows reserved device names', () => {
		expect(sanitizeName('CON')).toBe('CON_safe');
		expect(sanitizeName('con')).toBe('con_safe');
		expect(sanitizeName('PRN')).toBe('PRN_safe');
		expect(sanitizeName('NUL')).toBe('NUL_safe');
		expect(sanitizeName('AUX')).toBe('AUX_safe');
		expect(sanitizeName('COM1')).toBe('COM1_safe');
		expect(sanitizeName('LPT9')).toBe('LPT9_safe');
	});

	it('does not mangle names that merely contain a reserved word', () => {
		expect(sanitizeName('CONCERTO')).toBe('CONCERTO');
		expect(sanitizeName('my-con')).toBe('my-con');
	});

	it('falls back to "untitled" when nothing safe remains', () => {
		expect(sanitizeName('///...')).toBe('untitled');
		expect(sanitizeName('   ')).toBe('untitled');
		expect(sanitizeName('<>*?:')).toBe('untitled');
	});

	it('truncates overly long names to 200 characters', () => {
		const long = 'a'.repeat(300);
		const result = sanitizeName(long);
		expect(result).toHaveLength(200);
		expect(result).toBe('a'.repeat(200));
	});

	it('handles a typical user-typed song name unchanged', () => {
		expect(sanitizeName('My Awesome Drum Chart')).toBe('My Awesome Drum Chart');
	});
});
