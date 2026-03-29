import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PopoverStub from '../../../tests/stubs/PopoverStub.svelte';

const gotoMock = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

const localeMock = vi.hoisted(() => ({ set: vi.fn() }));
const localesMock = vi.hoisted(() => ({
	subscribe: (run: (value: string[]) => void) => {
		run(['en', 'jp']);
		return () => {};
	}
}));

vi.mock('svelte-i18n', () => ({
	locale: localeMock,
	locales: localesMock
}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Popover: PopoverStub
}));

import ToolPage from './+page.svelte';

describe('Tool Page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the page title', () => {
		render(ToolPage);
		expect(screen.getByText('Tools')).toBeInTheDocument();
	});

	it('renders all tool cards', () => {
		render(ToolPage);
		expect(screen.getByText('DTX to MIDI Converter')).toBeInTheDocument();
		expect(screen.getByText('MIDI to DTX Converter')).toBeInTheDocument();
		expect(screen.getByText('MIDI Preview')).toBeInTheDocument();
	});

	it('navigates to correct route when Open Tool is clicked', async () => {
		render(ToolPage);
		const openButtons = screen.getAllByText('Open Tool');
		await fireEvent.click(openButtons[0]);
		expect(gotoMock).toHaveBeenCalledWith('/tool/dtx-to-midi');
	});

	it('navigates to midi-to-dtx when second Open Tool is clicked', async () => {
		render(ToolPage);
		const openButtons = screen.getAllByText('Open Tool');
		await fireEvent.click(openButtons[1]);
		expect(gotoMock).toHaveBeenCalledWith('/tool/midi-to-dtx');
	});

	it('navigates to midi-preview when third Open Tool is clicked', async () => {
		render(ToolPage);
		const openButtons = screen.getAllByText('Open Tool');
		await fireEvent.click(openButtons[2]);
		expect(gotoMock).toHaveBeenCalledWith('/tool/midi-preview');
	});

	it('renders language options from locales', () => {
		render(ToolPage);
		expect(screen.getByText('Change Language')).toBeInTheDocument();
	});

	it('sets locale when language button is clicked', async () => {
		render(ToolPage);
		const enButton = screen.getByText('English');
		await fireEvent.click(enButton);
		expect(localeMock.set).toHaveBeenCalledWith('en');
	});
});
