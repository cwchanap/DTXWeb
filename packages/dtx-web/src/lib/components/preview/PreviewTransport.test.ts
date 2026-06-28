import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PreviewTransport from './PreviewTransport.svelte';

// Global __mocks__/svelte-i18n.ts: `_` returns the key unchanged.
vi.mock('svelte-i18n');

describe('PreviewTransport', () => {
	it('disables the button until audio is ready', () => {
		render(PreviewTransport, {
			props: { playing: false, audioReady: false, onToggle: vi.fn() }
		});
		expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
	});

	it('uses the loading label as its accessible name while audio is not ready', () => {
		render(PreviewTransport, {
			props: { playing: false, audioReady: false, onToggle: vi.fn() }
		});
		expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'preview.audio_loading');
	});

	it('uses the play label once audio is ready', () => {
		render(PreviewTransport, {
			props: { playing: false, audioReady: true, onToggle: vi.fn() }
		});
		expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'preview.play');
	});

	it('calls onToggle when clicked and ready', async () => {
		const onToggle = vi.fn();
		render(PreviewTransport, { props: { playing: false, audioReady: true, onToggle } });
		await fireEvent.click(screen.getByRole('button'));
		expect(onToggle).toHaveBeenCalledOnce();
	});
});
