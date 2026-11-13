import { beforeEach, describe, expect, it, vi } from 'vitest';

// HPA-316 temporary Windows diagnostics (remove after CI diagnosis). The
// module under test wraps googleDriveService.refreshConnection, so the tests
// drive a controllable refresh double and a real writable store double.
const refreshMock = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('./googleDriveService', () => ({
	googleDriveService: { refreshConnection: refreshMock }
}));

vi.mock('../stores/googleDriveStore', async () => {
	const { writable } = await import('svelte/store');
	const store = writable<{ connection: unknown; error: string | null }>({
		connection: null,
		error: null
	});
	return {
		googleDriveStore: store,
		setStoreState: (state: { connection: unknown; error: string | null }): void => {
			store.set(state);
		}
	};
});

type Snapshot = Record<string, boolean | number | null>;

const readSnapshot = (): Snapshot => {
	const read = (window as unknown as { __dtxDriveRefreshDiag?: () => Snapshot })
		.__dtxDriveRefreshDiag;
	if (typeof read !== 'function') throw new Error('diagnostics snapshot not exposed');
	return read();
};

const { installDriveRefreshDiagnostics } = await import('./driveRefreshDiagnostics');
const { googleDriveService } = await import('./googleDriveService');
const { setStoreState } = await import('../stores/googleDriveStore');

describe('driveRefreshDiagnostics', () => {
	beforeEach(() => {
		refreshMock.mockReset();
		setStoreState({ connection: null, error: null });
	});

	it('exposes the snapshot function exactly once and is idempotent', () => {
		expect(installDriveRefreshDiagnostics()).toBe(true);
		const wrapped = googleDriveService.refreshConnection;
		expect(installDriveRefreshDiagnostics()).toBe(false);
		expect(googleDriveService.refreshConnection).toBe(wrapped);
	});

	it('reports a settled connected refresh with the store outcome applied', async () => {
		const mockConnection = {
			connected: true,
			accessToken: 'TOKEN-SECRET',
			email: 'secret@example.com'
		};
		refreshMock.mockResolvedValueOnce(mockConnection);
		setStoreState({ connection: { connected: true }, error: null });

		const returned = await (
			googleDriveService.refreshConnection as () => Promise<{ connected: boolean }>
		)();

		// The wrapper forwards the original fulfillment value unchanged.
		expect(returned).toBe(mockConnection);
		const snapshot = readSnapshot();
		expect(snapshot).toMatchObject({
			observed: true,
			pending: false,
			resolved: true,
			rejected: false,
			withConnection: true,
			connected: true,
			storeConnected: true,
			storeHasError: false
		});
		expect(snapshot.calls).toBe(1);
	});

	it('reports a resolved connection that the store discarded (connected result, store not applied)', async () => {
		refreshMock.mockResolvedValueOnce({ connected: true });

		await (googleDriveService.refreshConnection as () => Promise<unknown>)();

		// Store deliberately left with connection: null — the snapshot must
		// separate "refresh produced connected:true" from "store applied it".
		expect(readSnapshot()).toMatchObject({
			resolved: true,
			withConnection: true,
			connected: true,
			storeConnected: false,
			storeHasError: false
		});
	});

	it('reports a resolved null (the real service catch path) as completion without a connection', async () => {
		refreshMock.mockResolvedValueOnce(null);

		await (googleDriveService.refreshConnection as () => Promise<unknown>)();

		expect(readSnapshot()).toMatchObject({
			pending: false,
			resolved: true,
			rejected: false,
			withConnection: false,
			connected: false
		});
	});

	it('passes a rejection through unchanged and flags it rejected', async () => {
		// The real service never rejects, but the wrapper must not swallow a
		// rejection if one ever propagates — that would change behavior.
		refreshMock.mockRejectedValueOnce(new Error('unexpected REJECT-SECRET'));

		await expect(
			(googleDriveService.refreshConnection as () => Promise<unknown>)()
		).rejects.toThrow('unexpected REJECT-SECRET');

		expect(readSnapshot()).toMatchObject({
			pending: false,
			resolved: false,
			rejected: true
		});
	});

	it('reports pending for an in-flight refresh without waiting for it', async () => {
		let settleLater!: (value: unknown) => void;
		refreshMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					settleLater = resolve;
				})
		);

		const inFlight = (googleDriveService.refreshConnection as () => Promise<unknown>)();
		const during = readSnapshot();
		expect(during).toMatchObject({ observed: true, pending: true, resolved: false });
		expect(during.settledAtMs).toBeNull();
		expect(typeof during.startedAtMs).toBe('number');

		settleLater({ connected: false });
		await inFlight;

		const after = readSnapshot();
		expect(after).toMatchObject({ pending: false, resolved: true, connected: false });
		expect(after.settledAtMs).not.toBeNull();
		expect((after.settledAtMs as number) >= (after.startedAtMs as number)).toBe(true);
	});

	it('counts multiple refresh calls and reports the latest outcome', async () => {
		const callsBefore = readSnapshot().calls as number;
		refreshMock.mockResolvedValueOnce({ connected: true });
		await (googleDriveService.refreshConnection as () => Promise<unknown>)();
		refreshMock.mockResolvedValueOnce({ connected: false });
		await (googleDriveService.refreshConnection as () => Promise<unknown>)();

		const snapshot = readSnapshot();
		expect(snapshot.calls).toBe(callsBefore + 2);
		expect(snapshot).toMatchObject({ resolved: true, connected: false, pending: false });
	});

	it('exposes only booleans, numbers, and nulls — never message content', async () => {
		refreshMock.mockResolvedValueOnce({
			connected: true,
			accessToken: 'TOKEN-SECRET',
			email: 'secret@example.com',
			errorText: 'native message CONTENT-SECRET'
		});

		const serialized = JSON.stringify(
			await (googleDriveService.refreshConnection as () => Promise<unknown>)().then(
				readSnapshot
			)
		);
		for (const value of Object.values(readSnapshot())) {
			expect(['boolean', 'number'].includes(typeof value) || value === null).toBe(true);
		}
		expect(serialized).not.toContain('TOKEN-SECRET');
		expect(serialized).not.toContain('secret@example.com');
		expect(serialized).not.toContain('CONTENT-SECRET');
	});
});
