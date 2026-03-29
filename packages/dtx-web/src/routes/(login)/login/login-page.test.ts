import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/environment', () => ({
	browser: false
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({
				url: new URL('http://localhost/login')
			});
			return () => {};
		}
	}
}));

vi.mock('@lucide/svelte', () => ({
	Loader: vi.fn()
}));

import LoginPage from './+page.svelte';

describe('Login Page', () => {
	it('shows loading spinner while checking auth state', () => {
		render(LoginPage);
		expect(screen.getByText('Checking login status...')).toBeInTheDocument();
	});

	it('renders the page structure', () => {
		render(LoginPage);
		const container = document.body.querySelector('.mt-16');
		expect(container).toBeInTheDocument();
	});
});
