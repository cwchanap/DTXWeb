import { afterEach, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock phaser module before any imports
vi.mock('phaser', async () => {
	const mock = await import('../../__mocks__/phaser.js');
	return { default: mock.default };
});

import '../../__mocks__/phaser';

// Mock canvas and its context for tests
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
	value: () => ({
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		fillRect: () => {},
		strokeRect: () => {},
		clearRect: () => {},
		measureText: () => ({ width: 0 }),
		// Canvas image data methods required by Phaser
		getImageData: () => ({
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1
		}),
		createImageData: () => ({
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1
		}),
		putImageData: () => {},
		// Additional canvas methods
		save: () => {},
		restore: () => {},
		translate: () => {},
		rotate: () => {},
		scale: () => {},
		transform: () => {},
		setTransform: () => {},
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		lineCap: 'butt',
		lineJoin: 'miter',
		miterLimit: 10,
		shadowBlur: 0,
		shadowColor: 'rgba(0, 0, 0, 0)',
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		font: '10px sans-serif',
		textAlign: 'start',
		textBaseline: 'alphabetic',
		direction: 'inherit',
		fillText: () => {},
		strokeText: () => {},
		beginPath: () => {},
		closePath: () => {},
		moveTo: () => {},
		lineTo: () => {},
		bezierCurveTo: () => {},
		quadraticCurveTo: () => {},
		arc: () => {},
		arcTo: () => {},
		ellipse: () => {},
		rect: () => {},
		fill: () => {},
		stroke: () => {},
		clip: () => {},
		isPointInPath: () => false,
		isPointInStroke: () => false,
		drawImage: () => {},
		createLinearGradient: () => ({
			addColorStop: () => {}
		}),
		createRadialGradient: () => ({
			addColorStop: () => {}
		}),
		createPattern: () => null
	})
});

// Mock URL.createObjectURL
global.URL = {
	createObjectURL: () => 'blob:mock-url',
	revokeObjectURL: () => {}
} as any;

beforeAll(() => {
	// Global test setup
});

// Setup for tests
afterEach(() => {
	// Cleanup after each test
	if (typeof document !== 'undefined') {
		document.body.innerHTML = '';
	}
});
