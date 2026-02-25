import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

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
			([event]: [string]) => event === 'error'
		);
		expect(errorCall).toBeDefined();
		const [, errorCallback] = errorCall!;

		errorCallback();

		await vi.waitFor(() => {
			expect(screen.queryByRole('button')).not.toBeInTheDocument();
		});
	});
});
