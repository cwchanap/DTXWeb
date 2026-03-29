import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const gotoMock = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

import HomePage from './+page.svelte';

describe('Home Page', () => {
	it('renders the Drumery brand name', () => {
		render(HomePage);
		expect(screen.getAllByText('Drumery').length).toBeGreaterThan(0);
	});

	it('renders navigation links', () => {
		render(HomePage);
		expect(screen.getByText('Charts')).toBeInTheDocument();
		expect(screen.getByText('Editor')).toBeInTheDocument();
		expect(screen.getByText('Tools')).toBeInTheDocument();
	});

	it('renders the hero section tagline', () => {
		render(HomePage);
		expect(screen.getByText('Feel the Beat')).toBeInTheDocument();
	});

	it('exposes blog navigation via Charts link', () => {
		render(HomePage);
		const chartsLink = screen.getAllByRole('link', { name: /charts/i })[0];
		expect(chartsLink).toHaveAttribute('href', '/blog');
	});

	it('navigates to blog when Explore Charts button is clicked', async () => {
		render(HomePage);
		const gotoChartsBtn = screen.getByText('🎵 Explore Charts');
		await fireEvent.click(gotoChartsBtn);
		expect(gotoMock).toHaveBeenCalledWith('/blog');
	});

	it('navigates to editor when Chart Editor button is clicked', async () => {
		render(HomePage);
		const tryEditorBtn = screen.getByText('✏️ Chart Editor');
		await fireEvent.click(tryEditorBtn);
		expect(gotoMock).toHaveBeenCalledWith('/editor');
	});

	it('navigates to tools when DTX Tools button is clicked', async () => {
		render(HomePage);
		const toolsBtn = screen.getByText('🛠️ DTX Tools');
		await fireEvent.click(toolsBtn);
		expect(gotoMock).toHaveBeenCalledWith('/tool');
	});
});
