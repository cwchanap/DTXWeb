import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const gotoMock = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

vi.mock('$lib/store', () => ({
	default: {
		activeScene: { set: vi.fn() }
	}
}));

vi.mock('@dtx/common/game', async () => {
	const mockMain = vi.fn().mockImplementation(() => null);
	return {
		default: mockMain,
		Editor: { key: 'EditorScene' }
	};
});

import GamePage from './+page.svelte';

describe('Game Page', () => {
	beforeEach(() => {
		gotoMock.mockClear();
	});

	it('renders the Editor button', () => {
		render(GamePage);
		expect(screen.getByText('Editor')).toBeInTheDocument();
	});

	it('renders the Main button', () => {
		render(GamePage);
		expect(screen.getByText('Main')).toBeInTheDocument();
	});

	it('navigates to /editor when Editor button is clicked', async () => {
		render(GamePage);
		await fireEvent.click(screen.getByText('Editor'));
		expect(gotoMock).toHaveBeenCalledWith('/editor');
	});

	it('navigates to / when Main button is clicked', async () => {
		render(GamePage);
		await fireEvent.click(screen.getByText('Main'));
		expect(gotoMock).toHaveBeenCalledWith('/');
	});
});
