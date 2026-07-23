import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// svelte/store mock is handled automatically from __mocks__/svelte/store.ts

// Mock phaser3spectorjs dependency that causes issues in tests
vi.mock('phaser3spectorjs', () => ({}));

// Mock @testing-library/svelte to bypass Svelte 5 compatibility issues
vi.mock('@testing-library/svelte', () => ({
	render: vi.fn(() => ({
		getByText: vi.fn(),
		getByDisplayValue: vi.fn(),
		container: document.createElement('div')
	})),
	fireEvent: {
		click: vi.fn(),
		input: vi.fn()
	}
}));

// Mock HTMLCanvasElement for Phaser tests (jsdom only — not available in node env)
if (typeof HTMLCanvasElement !== 'undefined') {
	Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
		value: vi.fn((contextType) => {
			if (contextType === '2d') {
				return {
					fillRect: vi.fn(),
					clearRect: vi.fn(),
					getImageData: vi.fn(() => ({ data: new Array(4) })),
					putImageData: vi.fn(),
					createImageData: vi.fn(() => ({ data: new Array(4) })),
					setTransform: vi.fn(),
					drawImage: vi.fn(),
					save: vi.fn(),
					fillText: vi.fn(),
					restore: vi.fn(),
					beginPath: vi.fn(),
					moveTo: vi.fn(),
					lineTo: vi.fn(),
					closePath: vi.fn(),
					stroke: vi.fn(),
					translate: vi.fn(),
					scale: vi.fn(),
					rotate: vi.fn(),
					arc: vi.fn(),
					fill: vi.fn(),
					measureText: vi.fn(() => ({ width: 0 })),
					transform: vi.fn(),
					rect: vi.fn(),
					clip: vi.fn()
				};
			} else if (contextType === 'webgl' || contextType === 'experimental-webgl') {
				return {
					canvas: {},
					drawingBufferWidth: 800,
					drawingBufferHeight: 600,
					getParameter: vi.fn(),
					getExtension: vi.fn(),
					createBuffer: vi.fn(),
					createProgram: vi.fn(),
					createShader: vi.fn(),
					shaderSource: vi.fn(),
					compileShader: vi.fn(),
					attachShader: vi.fn(),
					linkProgram: vi.fn(),
					useProgram: vi.fn(),
					enableVertexAttribArray: vi.fn(),
					vertexAttribPointer: vi.fn(),
					bindBuffer: vi.fn(),
					bufferData: vi.fn(),
					clear: vi.fn(),
					clearColor: vi.fn(),
					clearDepth: vi.fn(),
					enable: vi.fn(),
					disable: vi.fn(),
					depthFunc: vi.fn(),
					blendFunc: vi.fn(),
					viewport: vi.fn(),
					drawArrays: vi.fn(),
					drawElements: vi.fn(),
					finish: vi.fn(),
					flush: vi.fn(),
					deleteBuffer: vi.fn(),
					deleteProgram: vi.fn(),
					deleteShader: vi.fn()
				};
			}
			return null;
		})
	});

	// Mock other Canvas-related APIs that Phaser might use
	Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
		value: vi.fn(() => 'data:image/png;base64,mock')
	});

	Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
		value: vi.fn(() => ({
			top: 0,
			left: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
			x: 0,
			y: 0
		}))
	});
} // end if (typeof HTMLCanvasElement !== 'undefined')

// Mock Image constructor for Phaser image loading
global.Image = vi.fn().mockImplementation(() => {
	const img = {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		width: 1,
		height: 1,
		src: '',
		onload: null,
		onerror: null,
		complete: true,
		crossOrigin: null
	} as unknown as HTMLImageElement;

	// Trigger onload asynchronously
	setTimeout(() => {
		const loadHandler = img.onload;
		if (typeof loadHandler === 'function') {
			loadHandler.call(img, new Event('load'));
		}
	}, 0);

	return img;
}) as unknown as typeof Image;

// Mock Audio for Phaser audio
global.Audio = vi.fn().mockImplementation(() => ({
	play: vi.fn(),
	pause: vi.fn(),
	load: vi.fn(),
	canPlayType: vi.fn(() => 'probably'),
	addEventListener: vi.fn(),
	removeEventListener: vi.fn(),
	volume: 1,
	currentTime: 0,
	duration: 0,
	paused: true,
	ended: false,
	readyState: 4
}));

// Mock AudioContext for audio processing
global.AudioContext = vi.fn().mockImplementation(() => ({
	createBuffer: vi.fn(),
	createBufferSource: vi.fn(() => ({
		buffer: null,
		connect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn()
	})),
	createGain: vi.fn(() => ({
		gain: { value: 1 },
		connect: vi.fn()
	})),
	createAnalyser: vi.fn(() => ({
		connect: vi.fn(),
		fftSize: 2048,
		frequencyBinCount: 1024,
		getByteFrequencyData: vi.fn(),
		getByteTimeDomainData: vi.fn()
	})),
	createOscillator: vi.fn(() => ({
		frequency: { value: 440 },
		type: 'sine',
		connect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn()
	})),
	destination: {},
	sampleRate: 44100,
	currentTime: 0,
	state: 'running',
	suspend: vi.fn(),
	resume: vi.fn(),
	close: vi.fn(),
	decodeAudioData: vi.fn(() => Promise.resolve({}))
}));

// Mock File.prototype.arrayBuffer for encoding tests
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
	File.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = () => reject(reader.error);
			reader.readAsArrayBuffer(this);
		});
	};
}

// Setup for tests
afterEach(() => {
	// Cleanup after each test
	if (typeof document !== 'undefined') {
		document.body.innerHTML = '';
	}
});
