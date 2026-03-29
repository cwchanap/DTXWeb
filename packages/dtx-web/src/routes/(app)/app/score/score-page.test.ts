import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ScorePage from './+page.svelte';

describe('Score Page', () => {
	it('renders the page', () => {
		render(ScorePage);
		expect(screen.getByText('Hello World')).toBeInTheDocument();
	});
});
