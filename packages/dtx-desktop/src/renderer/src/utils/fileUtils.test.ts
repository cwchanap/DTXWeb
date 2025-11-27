import { describe, expect, it } from 'vitest';
import { toBlobPart } from './fileUtils';

describe('toBlobPart', () => {
	it('returns ArrayBuffer when given Uint8Array (including views with offsets)', () => {
		const backing = new Uint8Array([0, 1, 2, 3, 4, 5]);
		const view = new Uint8Array(backing.buffer, 2, 3); // [2,3,4]

		const part = toBlobPart(view);

		expect(part).toBeInstanceOf(ArrayBuffer);
		expect(Array.from(new Uint8Array(part as ArrayBuffer))).toEqual([2, 3, 4]);
	});

	it('passes through string and ArrayBuffer unchanged', () => {
		const text = 'abc';
		const buffer = new ArrayBuffer(2);
		expect(toBlobPart(text)).toBe(text);
		expect(toBlobPart(buffer)).toBe(buffer);
	});

	it('creates a usable File from a Uint8Array', () => {
		const bytes = new Uint8Array([65, 66]); // "AB"
		const file = new File([toBlobPart(bytes)], 'test.bin');
		expect(file.size).toBe(2);
	});
});
