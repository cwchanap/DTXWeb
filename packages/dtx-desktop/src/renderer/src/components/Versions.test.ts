import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

import Versions from './Versions.svelte';

describe('Versions', () => {
	afterEach(() => {
		cleanup();
	});

	it('displays electron version', () => {
		render(Versions);
		expect(screen.getByText('35.0.0')).toBeInTheDocument();
	});

	it('displays chrome version', () => {
		render(Versions);
		expect(screen.getByText('130.0.0')).toBeInTheDocument();
	});

	it('displays node version', () => {
		render(Versions);
		expect(screen.getByText('20.0.0')).toBeInTheDocument();
	});

	it('displays version labels', () => {
		render(Versions);
		expect(screen.getByText('Electron')).toBeInTheDocument();
		expect(screen.getByText('Chromium')).toBeInTheDocument();
		expect(screen.getByText('Node.js')).toBeInTheDocument();
	});
});
