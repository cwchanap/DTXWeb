import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/components/ChartList.svelte', () => ({
	default: vi.fn()
}));

import ChartPage from './+page.svelte';

describe('Chart Page', () => {
	it('renders the chart page heading', () => {
		render(ChartPage);
		expect(screen.getByText('My Chart')).toBeInTheDocument();
	});

	it('renders the container', () => {
		render(ChartPage);
		const container = document.querySelector('.container');
		expect(container).toBeInTheDocument();
	});
});
