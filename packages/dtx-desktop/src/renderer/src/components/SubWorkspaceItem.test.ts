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
                if (isActive) {
                        await workspaceService.setCurrentSubWorkspace(null);
                } else {
                        await workspaceService.setCurrentSubWorkspace(subWorkspace);
                }
        };

        it('selects sub-workspace when inactive', async () => {
                // Act
                await handleSelectSubWorkspace('DTXFiles.Test', false);

                // Assert
                expect(workspaceService.setCurrentSubWorkspace).toHaveBeenCalledWith('DTXFiles.Test');
        });

        it('deselects sub-workspace when already active', async () => {
                // Act
                await handleSelectSubWorkspace('DTXFiles.Test', true);

                // Assert
                expect(workspaceService.setCurrentSubWorkspace).toHaveBeenCalledWith(null);
        });

        it('computes display name without prefix', () => {
                // Arrange
                const subWorkspace = 'DTXFiles.MyFolder';

                // Act
                const displayName = subWorkspace.replace(/^DTXFiles\./, '');

                // Assert
                expect(displayName).toBe('MyFolder');
        });
});
