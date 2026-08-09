import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('svelte-i18n');
vi.mock('@lucide/svelte/icons');

import ImageAudio from './ImageAudio.svelte';
import type { AudioPreview } from '$lib/audioPreview.svelte';

const makeAudio = (overrides: Partial<AudioPreview> = {}): AudioPreview => ({
	isPlaying: false,
	isLoading: false,
	available: true,
	toggle: vi.fn().mockResolvedValue(undefined),
	...overrides
});

const previewUrl = 'https://cdn.example.com/preview.jpg';

describe('ImageAudio', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the preview image', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
		expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
	});

	it('omits the control when idle', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('omits the control when audio is unavailable, even while playing', () => {
		render(ImageAudio, {
			props: { previewUrl, audio: makeAudio({ available: false, isPlaying: true }) }
		});
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('renders the control and labels it as pause while playing', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isPlaying: true }) } });
		expect(
			screen.getByRole('button', { name: 'chart_actions.pause_audio' })
		).toBeInTheDocument();
	});

	it('renders the control and labels it as play while loading', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isLoading: true }) } });
		expect(
			screen.getByRole('button', { name: 'chart_actions.play_audio' })
		).toBeInTheDocument();
	});

	it('delegates clicks to the audio unit', async () => {
		const audio = makeAudio({ isPlaying: true });
		render(ImageAudio, { props: { previewUrl, audio } });

		await fireEvent.click(screen.getByRole('button'));

		expect(audio.toggle).toHaveBeenCalledOnce();
	});

	it('disables the control while loading', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isLoading: true }) } });
		expect(screen.getByRole('button')).toBeDisabled();
	});

	it('shows the image error fallback when the image fails to load', async () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
		await fireEvent.error(screen.getByRole('img', { name: 'Preview' }));
		expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
	});
});
