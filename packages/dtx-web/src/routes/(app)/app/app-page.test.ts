import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/environment', () => ({
	browser: false
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({
				url: new URL('http://localhost/app'),
				params: {}
			});
			return () => {};
		}
	}
}));

vi.mock('@lucide/svelte');

import AppPage from './+page.svelte';

describe('App Home Page', () => {
	it('renders the welcome dashboard when not redirecting', () => {
		render(AppPage);
		expect(screen.getByText('Welcome to Drumery')).toBeInTheDocument();
	});

	it('renders the dashboard content', () => {
		render(AppPage);
		expect(screen.getByText('Your app dashboard content goes here.')).toBeInTheDocument();
	});
});
