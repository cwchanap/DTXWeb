import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import PreviewPage from './+page.svelte';

const getSimfileMock = vi.hoisted(() => vi.fn());
const parseFromRemoteURLMock = vi.hoisted(() => vi.fn());
const buildNotationChartMock = vi.hoisted(() => vi.fn());

// Uses the global __mocks__/svelte-i18n.ts where `_` returns the key unchanged,
// so assertions below match on i18n keys, not translated English.
vi.mock('svelte-i18n');
vi.mock('$lib/api', () => ({ getSimfile: getSimfileMock }));
vi.mock('$env/static/public', () => ({ PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.test' }));
vi.mock('$lib/components/preview/NotationView.svelte', async () => {
	const Stub = (await import('../../../lib/components/preview/__stubs__/NotationViewStub.svelte'))
		.default;
	return { default: Stub };
});

vi.mock('@dtx/common', () => ({
	SimFile: { parseFromRemoteURL: parseFromRemoteURLMock },
	buildNotationChart: buildNotationChartMock,
	PreviewAudioEngine: class {
		onEnded?: () => void;
		async load() {
			return { loaded: 0, failedFiles: [] };
		}
		play() {}
		pause() {}
		seek() {}
		get currentTime() {
			return 0;
		}
		get duration() {
			return 0;
		}
		dispose() {}
	}
}));
vi.mock('$lib/toaster', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

let routeId: string | null = '5';
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (v: unknown) => void) => {
			run({
				url: new URL(`https://app.test/preview/${routeId ?? ''}`),
				params: { id: routeId ?? '' }
			});
			return () => {};
		}
	}
}));

const makeDtx = () => ({
	title: 'Song',
	bpm: 120,
	difficulty: 'MASTER',
	parseSoundChips: () => []
});

describe('/preview page', () => {
	beforeEach(() => {
		routeId = '5';
		getSimfileMock.mockReset();
		parseFromRemoteURLMock.mockReset();
		buildNotationChartMock.mockReset();
		buildNotationChartMock.mockReturnValue({
			chart: { measures: [] },
			timing: { totalDuration: 0 },
			notesByLane: {},
			measureCount: 0
		});
	});

	it('shows "not available" when the simfile is not found', async () => {
		getSimfileMock.mockRejectedValue(new Error('Simfile not found'));
		render(PreviewPage);
		await waitFor(() => expect(screen.getByText('preview.not_available')).toBeTruthy());
	});

	it('renders the notation when the chart loads', async () => {
		getSimfileMock.mockResolvedValue({
			id: 5,
			title: 'Song',
			artist: 'Artist',
			dtx_files: [{ level: 4, label: 'MASTER' }]
		});
		const simFile = {
			title: 'Song',
			levels: { 4: { label: 'MASTER', file: makeDtx() } },
			getHighestLevel: () => makeDtx(),
			getLevel: () => makeDtx()
		};
		parseFromRemoteURLMock.mockResolvedValue(simFile);
		render(PreviewPage);
		await waitFor(() => expect(screen.getByTestId('notation-stub')).toBeTruthy());
	});
});
