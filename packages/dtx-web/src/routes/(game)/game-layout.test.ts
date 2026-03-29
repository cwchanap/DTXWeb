import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GameLayout from './+layout.svelte';

describe('Game Layout', () => {
	it('renders the game layout container', () => {
		render(GameLayout);
		const appContainer = document.getElementById('app');
		expect(appContainer).toBeInTheDocument();
	});

	it('renders with game title in head', () => {
		render(GameLayout);
		expect(document.title).toBe('Drumery - Game');
	});
});
