import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn utility', () => {
	it('returns an empty string with no arguments', () => {
		expect(cn()).toBe('');
	});

	it('returns a single class name unchanged', () => {
		expect(cn('foo')).toBe('foo');
	});

	it('joins multiple class names with a space', () => {
		expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
	});

	it('ignores falsy values', () => {
		expect(cn('foo', undefined, null, false, 'bar')).toBe('foo bar');
	});

	it('merges conflicting Tailwind classes, keeping the last one', () => {
		expect(cn('p-2', 'p-4')).toBe('p-4');
		expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
	});

	it('handles conditional classes via objects', () => {
		expect(cn({ 'font-bold': true, italic: false })).toBe('font-bold');
	});

	it('handles array inputs', () => {
		expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz');
	});

	it('handles mixed conditional and unconditional classes', () => {
		const isActive = true;
		const isDisabled = false;
		expect(cn('base', { active: isActive, disabled: isDisabled })).toBe('base active');
	});

	it('deduplicates identical class names via tailwind-merge', () => {
		expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
	});
});
