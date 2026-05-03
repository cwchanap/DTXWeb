import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('@dtx/common/components');

import EditorTabs from './EditorTabs.svelte';

const defaultProps = {
	currentTab: 0,
	isTabsCollapsed: false,
	isPreviewing: false,
	isEditorReady: true,
	simfileID: '',
	hasSimfile: false,
	bucketUrl: 'https://cdn.example.com',
	onTabChange: vi.fn(),
	onToggleCollapsed: vi.fn()
};

describe('EditorTabs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders Editor Tabs heading', () => {
		render(EditorTabs, { props: defaultProps });
		expect(screen.getByText('Editor Tabs')).toBeInTheDocument();
	});

	it('shows tab buttons when not collapsed', () => {
		render(EditorTabs, { props: defaultProps });
		expect(screen.getByRole('button', { name: 'Main' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sound' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
	});

	it('hides tab panel content when isTabsCollapsed is true', () => {
		render(EditorTabs, { props: { ...defaultProps, isTabsCollapsed: true } });
		expect(screen.queryByRole('button', { name: 'Main' })).not.toBeInTheDocument();
	});

	it('calls onToggleCollapsed when toggle button is clicked', async () => {
		const onToggleCollapsed = vi.fn();
		render(EditorTabs, { props: { ...defaultProps, onToggleCollapsed } });
		await fireEvent.click(screen.getByRole('button', { name: /Editor Tabs/i }));
		expect(onToggleCollapsed).toHaveBeenCalledOnce();
	});

	it('calls onTabChange with 0 when Main tab is clicked', async () => {
		const onTabChange = vi.fn();
		render(EditorTabs, { props: { ...defaultProps, onTabChange } });
		await fireEvent.click(screen.getByRole('button', { name: 'Main' }));
		expect(onTabChange).toHaveBeenCalledWith(0);
	});

	it('calls onTabChange with 1 when Sound tab is clicked', async () => {
		const onTabChange = vi.fn();
		render(EditorTabs, { props: { ...defaultProps, onTabChange } });
		await fireEvent.click(screen.getByRole('button', { name: 'Sound' }));
		expect(onTabChange).toHaveBeenCalledWith(1);
	});

	it('calls onTabChange with 2 when Preview tab is clicked', async () => {
		const onTabChange = vi.fn();
		render(EditorTabs, { props: { ...defaultProps, onTabChange } });
		await fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
		expect(onTabChange).toHaveBeenCalledWith(2);
	});

	it('hides Sound tab when isPreviewing is true', () => {
		render(EditorTabs, { props: { ...defaultProps, isPreviewing: true } });
		expect(screen.queryByRole('button', { name: 'Sound' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Main' })).toBeInTheDocument();
	});
});
