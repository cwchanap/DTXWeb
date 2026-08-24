import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import AppPage from './+page.svelte';

describe('App Home Page', () => {
	it('renders the dashboard content', () => {
		render(AppPage);
		expect(screen.getByText('Your app dashboard content goes here.')).toBeInTheDocument();
	});
});
