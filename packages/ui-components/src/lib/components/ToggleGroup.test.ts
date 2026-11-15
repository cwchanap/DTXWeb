import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ToggleGroup from './ToggleGroup.svelte';

describe('ToggleGroup keyed option reconciliation', () => {
	const baseOptions = [
		{ value: 'a', label: 'Alpha' },
		{ value: 'b', label: 'Beta' },
		{ value: 'c', label: 'Gamma' }
	];
	const buttons = () => screen.getAllByRole('button');

	it('moves option nodes by key on reorder/insertion and keeps the selected option', async () => {
		const { rerender } = render(ToggleGroup, {
			props: { options: baseOptions, ariaLabel: 'options' }
		});

		// Select Beta through the real click path — handleSelect writes the
		// $bindable value and aria-pressed flips on that option's own button.
		await fireEvent.click(buttons()[1]);
		const betaButton = buttons()[1];
		const alphaButton = buttons()[0];
		expect(betaButton.getAttribute('aria-pressed')).toBe('true');

		// A bound parent echoes the current value back on each update, so pass
		// `value` through rerenders. Reorder [a,b,c] -> [c,a,b]: keyed
		// reconciliation moves each option's node with its data; positional
		// patching would leave a different node at index 2 showing 'Beta'.
		await rerender({
			options: [baseOptions[2], baseOptions[0], baseOptions[1]],
			value: 'b'
		});
		expect(buttons()[2]).toBe(betaButton);
		expect(buttons()[1]).toBe(alphaButton);
		expect(buttons()[0].textContent?.trim()).toBe('Gamma');
		expect(betaButton.getAttribute('aria-pressed')).toBe('true');

		// Insert a new option at the front: existing keyed nodes shift position
		// untouched, and a fresh node renders the inserted option.
		await rerender({
			options: [
				{ value: 'z', label: 'Zeta' },
				baseOptions[2],
				baseOptions[0],
				baseOptions[1]
			],
			value: 'b'
		});
		expect(buttons()[3]).toBe(betaButton);
		expect(buttons()[0].textContent?.trim()).toBe('Zeta');
		expect(betaButton.getAttribute('aria-pressed')).toBe('true');

		// Selection still lands on the clicked option after list mutation.
		await fireEvent.click(buttons()[2]);
		expect(buttons()[2]).toBe(alphaButton);
		expect(alphaButton.getAttribute('aria-pressed')).toBe('true');
		expect(betaButton.getAttribute('aria-pressed')).not.toBe('true');
	});
});
