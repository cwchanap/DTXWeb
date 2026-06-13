import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExposedElectron = {
	process: {
		versions: NodeJS.ProcessVersions;
	};
	ipcRenderer: {
		invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
	};
};

const mockPreload = vi.hoisted(() => {
	const exposed: Record<string, unknown> = {};
	return {
		exposed,
		ipcInvoke: vi.fn(),
		exposeInMainWorld: vi.fn((key: string, value: unknown) => {
			exposed[key] = value;
		})
	};
});

vi.mock('electron', () => ({
	contextBridge: {
		exposeInMainWorld: mockPreload.exposeInMainWorld
	},
	ipcRenderer: {
		invoke: mockPreload.ipcInvoke
	}
}));

vi.mock('@electron-toolkit/preload', () => ({
	electronAPI: {
		ipcRenderer: {
			send: vi.fn(),
			on: vi.fn(),
			invoke: vi.fn(),
			removeListener: vi.fn(),
			removeAllListeners: vi.fn()
		}
	}
}));

describe('preload bridge', () => {
	beforeEach(async () => {
		vi.resetModules();
		mockPreload.ipcInvoke.mockReset();
		mockPreload.exposeInMainWorld.mockClear();
		for (const key of Object.keys(mockPreload.exposed)) {
			delete mockPreload.exposed[key];
		}
		Object.defineProperty(process, 'contextIsolated', {
			configurable: true,
			value: true
		});

		await import('./index');
	});

	it('exposes process versions to the renderer', () => {
		const electron = mockPreload.exposed.electron as ExposedElectron;

		expect(electron.process.versions).toBe(process.versions);
		expect(electron.process.versions.node).toBe(process.versions.node);
	});

	it('allows check-for-update through the invoke whitelist', async () => {
		const electron = mockPreload.exposed.electron as ExposedElectron;
		mockPreload.ipcInvoke.mockResolvedValue({ success: true, updateInfo: null });

		await expect(electron.ipcRenderer.invoke('check-for-update')).resolves.toEqual({
			success: true,
			updateInfo: null
		});
		expect(mockPreload.ipcInvoke).toHaveBeenCalledWith('check-for-update');
	});

	it('rejects unauthorized invoke channels', () => {
		const electron = mockPreload.exposed.electron as ExposedElectron;

		expect(() => electron.ipcRenderer.invoke('not-allowed')).toThrow(
			'Unauthorized IPC channel: not-allowed'
		);
		expect(mockPreload.ipcInvoke).not.toHaveBeenCalled();
	});
});
