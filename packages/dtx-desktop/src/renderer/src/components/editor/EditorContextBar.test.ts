import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
vi.mock('@lucide/svelte');
import EditorContextBar from './EditorContextBar.svelte';

const base = {
	songName: 'Tank',
	simFileId: undefined,
	difficulties: [{ name: 'mas.dtx' }, { name: 'bas.dtx' }],
	currentDtx: 'mas.dtx',
	onBack: vi.fn(),
	onSwitchDifficulty: vi.fn()
};

describe('EditorContextBar', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows the song name', () => {
		render(EditorContextBar, base);
		expect(screen.getByText(/Tank/)).toBeInTheDocument();
	});
	it('calls onBack', async () => {
		render(EditorContextBar, base);
		await fireEvent.click(screen.getByRole('button', { name: /Back to library/i }));
		expect(base.onBack).toHaveBeenCalled();
	});
	it('calls onSwitchDifficulty on change', async () => {
		render(EditorContextBar, base);
		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bas.dtx' } });
		expect(base.onSwitchDifficulty).toHaveBeenCalledWith('bas.dtx');
	});
});
