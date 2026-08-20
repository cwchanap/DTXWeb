import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import AppPage from './+page.svelte';

describe('App Home Page', () => {
	it('ignores the removed desktop redirect handoff', () => {
		const originalUrl = window.location.href;
		window.history.replaceState({}, '', '/app?redirect=desktop');

		try {
			render(AppPage);
			expect(screen.getByText('Welcome to Drumery')).toBeInTheDocument();
		} finally {
			window.history.replaceState({}, '', originalUrl);
		}
	});

	it('renders the dashboard content', () => {
		render(AppPage);
		expect(screen.getByText('Your app dashboard content goes here.')).toBeInTheDocument();
	});
});
