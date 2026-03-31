import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get as mockGet } from 'svelte/store';

const mockPlayingAudio = vi.hoisted(() => ({
	subscribe: vi.fn((cb: (v: unknown) => void) => {
		cb(null);
		return () => {};
	}),
	set: vi.fn()
}));

vi.mock('$lib/store', () => ({
	default: { playingAudio: mockPlayingAudio }
}));

const mockAudio = vi.hoisted(() => ({
	play: vi.fn().mockResolvedValue(undefined),
	pause: vi.fn(),
	addEventListener: vi.fn(),
	remove: vi.fn(),
	currentTime: 0,
	src: '',
	load: vi.fn()
}));

import ImageAudio from './ImageAudio.svelte';

describe('ImageAudio', () => {
	const defaultProps = {
		previewUrl: 'https://cdn.example.com/preview.jpg',
		soundPreviewUrl: 'https://cdn.example.com/preview.mp3'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'Audio',
			vi.fn(() => mockAudio)
		);
		mockPlayingAudio.subscribe.mockImplementation((cb: (v: unknown) => void) => {
			cb(null);
			return () => {};
		});
		mockAudio.play.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders the preview image', () => {
		render(ImageAudio, { props: defaultProps });
		expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
	});

	it('renders play button when soundPreviewUrl is provided', () => {
		render(ImageAudio, { props: defaultProps });
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('does not render play button when soundPreviewUrl is null', () => {
		render(ImageAudio, { props: { ...defaultProps, soundPreviewUrl: null } });
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('creates Audio and calls play when play button is clicked', async () => {
		render(ImageAudio, { props: defaultProps });
		await fireEvent.click(screen.getByRole('button'));
		expect(global.Audio).toHaveBeenCalledWith(defaultProps.soundPreviewUrl);
		expect(mockAudio.play).toHaveBeenCalledOnce();
	});

	it('pauses audio when play button is clicked again while playing', async () => {
		render(ImageAudio, { props: defaultProps });
		// First click: start playing
		await fireEvent.click(screen.getByRole('button'));
		// Second click: pause
		await fireEvent.click(screen.getByRole('button'));
		expect(mockAudio.pause).toHaveBeenCalledOnce();
	});

	it('shows image error fallback when image fails to load', async () => {
		render(ImageAudio, { props: defaultProps });
		const img = screen.getByRole('img', { name: 'Preview' });
		await fireEvent.error(img);
		expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
	});

	it('hides play button when audio error event fires', async () => {
		render(ImageAudio, { props: defaultProps });

		await fireEvent.click(screen.getByRole('button'));

		const errorCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'error'
		);
		expect(errorCall).toBeDefined();
		const [, errorCallback] = errorCall!;

		errorCallback();

		await vi.waitFor(() => {
			expect(screen.queryByRole('button')).not.toBeInTheDocument();
		});
	});

	it('resets isPlaying and clears playingAudio when audio ends', async () => {
		render(ImageAudio, { props: defaultProps });
		await fireEvent.click(screen.getByRole('button'));

		const endedCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'ended'
		);
		expect(endedCall).toBeDefined();
		const [, endedCallback] = endedCall!;

		endedCallback();

		await vi.waitFor(() => {
			expect(mockPlayingAudio.set).toHaveBeenCalledWith(null);
		});
	});

	it('handles audio.play() rejection gracefully', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockAudio.play.mockRejectedValueOnce(new Error('NotAllowedError'));
		try {
			render(ImageAudio, { props: defaultProps });
			await fireEvent.click(screen.getByRole('button'));

			await vi.waitFor(() => {
				expect(screen.queryByRole('button')).not.toBeInTheDocument();
			});
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it('cleans up previous audio instance when replaying after ended', async () => {
		render(ImageAudio, { props: defaultProps });

		// First play
		await fireEvent.click(screen.getByRole('button'));

		// Trigger ended event to set isPlaying = false while audio is still set
		const endedCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'ended'
		);
		expect(endedCall).toBeDefined();
		const [, endedCallback] = endedCall!;
		endedCallback();

		// Wait for isPlaying to be false (play button visible again)
		await vi.waitFor(() => {
			expect(screen.getByRole('button')).toBeInTheDocument();
		});

		mockAudio.pause.mockClear();
		mockAudio.remove.mockClear();

		// Second play - should clean up the previous audio (lines 62-65)
		await fireEvent.click(screen.getByRole('button'));

		expect(mockAudio.pause).toHaveBeenCalled();
		expect(mockAudio.remove).toHaveBeenCalled();
	});

	it('pauses and removes currently playing audio from store before starting new', async () => {
		const existingAudio = { pause: vi.fn(), remove: vi.fn() };
		// The global __mocks__/svelte/store.ts mocks `get` as vi.fn() returning undefined.
		// Make it return existingAudio for the next call so lines 57-61 in ImageAudio.svelte execute.
		vi.mocked(mockGet).mockReturnValueOnce(existingAudio as unknown as HTMLAudioElement);

		render(ImageAudio, { props: defaultProps });
		await fireEvent.click(screen.getByRole('button'));

		expect(existingAudio.pause).toHaveBeenCalled();
		expect(existingAudio.remove).toHaveBeenCalled();
		expect(mockPlayingAudio.set).toHaveBeenCalledWith(null);
	});

	it('cleans up audio when soundPreviewUrl prop changes', async () => {
		const { rerender } = render(ImageAudio, { props: defaultProps });

		// Start playing first
		await fireEvent.click(screen.getByRole('button'));

		// Change the soundPreviewUrl to trigger the $effect cleanup
		await rerender({
			previewUrl: defaultProps.previewUrl,
			soundPreviewUrl: 'https://cdn.example.com/new.mp3'
		});

		// The $effect should clean up audio (pause, reset src, reload)
		await vi.waitFor(() => {
			expect(mockAudio.pause).toHaveBeenCalled();
		});
	});
});
