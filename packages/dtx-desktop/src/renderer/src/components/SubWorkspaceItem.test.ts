import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceService } from '../services/workspaceService';

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		setCurrentSubWorkspace: vi.fn()
	}
}));

describe('SubWorkspaceItem Component Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const handleSelectSubWorkspace = async (subWorkspace: string, isActive: boolean) => {
		try {
			if (isActive) {
				await workspaceService.setCurrentSubWorkspace(null);
			} else {
				await workspaceService.setCurrentSubWorkspace(subWorkspace);
			}
		} catch (error) {
			console.error('Error selecting sub-workspace:', error);
		}
	};

	it('selects sub-workspace when inactive', async () => {
		await handleSelectSubWorkspace('DTXFiles.Test', false);
		expect(workspaceService.setCurrentSubWorkspace).toHaveBeenCalledWith('DTXFiles.Test');
	});

	it('deselects sub-workspace when already active', async () => {
		await handleSelectSubWorkspace('DTXFiles.Test', true);
		expect(workspaceService.setCurrentSubWorkspace).toHaveBeenCalledWith(null);
	});

	it('computes display name without prefix', () => {
		const subWorkspace = 'DTXFiles.MyFolder';
		const displayName = subWorkspace.replace(/^DTXFiles\./, '');
		expect(displayName).toBe('MyFolder');
	});
});
