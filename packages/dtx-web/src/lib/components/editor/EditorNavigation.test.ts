import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { makeWorkspace } from '../../../tests/mocks/services';

vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PopoverStub } = await import('../../../tests/stubs/PopoverStub.svelte');
	return { Popover: PopoverStub };
});

import EditorNavigation from './EditorNavigation.svelte';

const callbacks = {
	onNewFile: vi.fn(),
	onImportFile: vi.fn(),
	onImportFolder: vi.fn(),
	onExportFile: vi.fn(),
	onShowDTXSwitcher: vi.fn(),
	onShowWorkspaceManager: vi.fn(),
	onShowSoundLibraryModal: vi.fn(),
	onRefreshSoundLibraryLinks: vi.fn(),
	onShowWorkspaceExporter: vi.fn(),
	onShowDifficultyModal: vi.fn()
};

const defaultProps = {
	simfileID: '',
	isPreviewing: false,
	hasSimfile: false,
	currentWorkspace: null,
	availableWorkspaces: [],
	...callbacks
};

describe('EditorNavigation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('File menu rendering', () => {
		it('renders the File trigger label when simfileID is empty', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(screen.getByText('File')).toBeInTheDocument();
		});

		it('does not render File menu when simfileID is set', () => {
			render(EditorNavigation, {
				props: { ...defaultProps, simfileID: 'some-id', hasSimfile: true }
			});
			expect(screen.queryByText('File')).not.toBeInTheDocument();
		});

		it('renders Switch Difficulty button when simfileID is set and hasSimfile is true', () => {
			render(EditorNavigation, {
				props: { ...defaultProps, simfileID: 'some-id', hasSimfile: true }
			});
			expect(screen.getByRole('button', { name: 'Switch Difficulty' })).toBeInTheDocument();
		});

		it('does not render Switch Difficulty button when hasSimfile is false (recovery flow)', () => {
			render(EditorNavigation, {
				props: { ...defaultProps, simfileID: 'some-id', hasSimfile: false }
			});
			expect(
				screen.queryByRole('button', { name: 'Switch Difficulty' })
			).not.toBeInTheDocument();
		});

		it('shows local File/Workspace controls when simfileID is set but hasSimfile is false (recovered draft)', () => {
			render(EditorNavigation, {
				props: { ...defaultProps, simfileID: 'some-id', hasSimfile: false }
			});
			// After draft recovery on a remote route, local controls should be available
			expect(screen.getByText('File')).toBeInTheDocument();
			expect(screen.getByText('Workspace')).toBeInTheDocument();
		});

		it('does not render Switch Difficulty button when simfileID is empty', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(
				screen.queryByRole('button', { name: 'Switch Difficulty' })
			).not.toBeInTheDocument();
		});

		it('renders New button in File menu', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
		});

		it('renders Export File button', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Export File' })).toBeInTheDocument();
		});

		it('renders Import File and Import Folder when simfileID is empty', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Import File' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Import Folder' })).toBeInTheDocument();
		});

		it('renders Switch DTX button when no simfileID and workspace has multiple dtxFiles', () => {
			const ws = makeWorkspace();
			render(EditorNavigation, {
				props: { ...defaultProps, currentWorkspace: ws }
			});
			expect(screen.getByRole('button', { name: 'Switch DTX' })).toBeInTheDocument();
		});

		it('does not render Switch DTX when workspace has one dtxFile', () => {
			const ws = makeWorkspace({
				dtxFiles: [{ name: 'only.dtx', content: '', path: '/only.dtx' }]
			});
			render(EditorNavigation, {
				props: { ...defaultProps, currentWorkspace: ws }
			});
			expect(screen.queryByRole('button', { name: 'Switch DTX' })).not.toBeInTheDocument();
		});

		it('renders Export Workspace button when there are availableWorkspaces and no simfileID', () => {
			const ws = makeWorkspace();
			render(EditorNavigation, {
				props: { ...defaultProps, availableWorkspaces: [ws] }
			});
			expect(screen.getByRole('button', { name: 'Export Workspace' })).toBeInTheDocument();
		});

		it('does not render Export Workspace button when availableWorkspaces is empty', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(
				screen.queryByRole('button', { name: 'Export Workspace' })
			).not.toBeInTheDocument();
		});
	});

	describe('Workspace menu rendering', () => {
		it('renders the Workspace trigger label when simfileID is empty', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(screen.getByText('Workspace')).toBeInTheDocument();
		});

		it('does not render Workspace menu when simfileID is set', () => {
			render(EditorNavigation, {
				props: { ...defaultProps, simfileID: 'some-id', hasSimfile: true }
			});
			expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
			// But Switch Difficulty button should be rendered for remote charts with simfile
			expect(screen.getByRole('button', { name: 'Switch Difficulty' })).toBeInTheDocument();
		});

		it('renders Manage Sound files library in workspace menu', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(
				screen.getByRole('button', { name: 'Manage Sound files library' })
			).toBeInTheDocument();
		});

		it('renders Refresh Sound Library Links in workspace menu', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(
				screen.getByRole('button', { name: 'Refresh Sound Library Links' })
			).toBeInTheDocument();
		});

		it('renders Manage Workspace button when there are available workspaces', () => {
			const ws = makeWorkspace();
			render(EditorNavigation, {
				props: { ...defaultProps, availableWorkspaces: [ws] }
			});
			expect(screen.getByRole('button', { name: 'Manage Workspace' })).toBeInTheDocument();
		});

		it('does not render Manage Workspace button when availableWorkspaces is empty', () => {
			render(EditorNavigation, { props: defaultProps });
			expect(
				screen.queryByRole('button', { name: 'Manage Workspace' })
			).not.toBeInTheDocument();
		});
	});

	describe('Callback invocations', () => {
		it('calls onNewFile when New button is clicked', async () => {
			const onNewFile = vi.fn();
			render(EditorNavigation, { props: { ...defaultProps, onNewFile } });
			await fireEvent.click(screen.getByRole('button', { name: 'New' }));
			expect(onNewFile).toHaveBeenCalledOnce();
		});

		it('calls onImportFile when Import File button is clicked', async () => {
			const onImportFile = vi.fn();
			render(EditorNavigation, { props: { ...defaultProps, onImportFile } });
			await fireEvent.click(screen.getByRole('button', { name: 'Import File' }));
			expect(onImportFile).toHaveBeenCalledOnce();
		});

		it('calls onImportFolder when Import Folder button is clicked', async () => {
			const onImportFolder = vi.fn();
			render(EditorNavigation, { props: { ...defaultProps, onImportFolder } });
			await fireEvent.click(screen.getByRole('button', { name: 'Import Folder' }));
			expect(onImportFolder).toHaveBeenCalledOnce();
		});

		it('calls onExportFile when Export File button is clicked', async () => {
			const onExportFile = vi.fn();
			render(EditorNavigation, { props: { ...defaultProps, onExportFile } });
			await fireEvent.click(screen.getByRole('button', { name: 'Export File' }));
			expect(onExportFile).toHaveBeenCalledOnce();
		});

		it('calls onShowDTXSwitcher when Switch DTX button is clicked', async () => {
			const onShowDTXSwitcher = vi.fn();
			const ws = makeWorkspace();
			render(EditorNavigation, {
				props: { ...defaultProps, currentWorkspace: ws, onShowDTXSwitcher }
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Switch DTX' }));
			expect(onShowDTXSwitcher).toHaveBeenCalledOnce();
		});

		it('calls onShowSoundLibraryModal when Manage Sound files library is clicked', async () => {
			const onShowSoundLibraryModal = vi.fn();
			render(EditorNavigation, { props: { ...defaultProps, onShowSoundLibraryModal } });
			await fireEvent.click(
				screen.getByRole('button', { name: 'Manage Sound files library' })
			);
			expect(onShowSoundLibraryModal).toHaveBeenCalledOnce();
		});

		it('calls onRefreshSoundLibraryLinks when Refresh Sound Library Links is clicked', async () => {
			const onRefreshSoundLibraryLinks = vi.fn();
			render(EditorNavigation, { props: { ...defaultProps, onRefreshSoundLibraryLinks } });
			await fireEvent.click(
				screen.getByRole('button', { name: 'Refresh Sound Library Links' })
			);
			expect(onRefreshSoundLibraryLinks).toHaveBeenCalledOnce();
		});

		it('calls onShowWorkspaceManager when Manage Workspace is clicked', async () => {
			const onShowWorkspaceManager = vi.fn();
			const ws = makeWorkspace();
			render(EditorNavigation, {
				props: { ...defaultProps, availableWorkspaces: [ws], onShowWorkspaceManager }
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Manage Workspace' }));
			expect(onShowWorkspaceManager).toHaveBeenCalledOnce();
		});

		it('calls onShowWorkspaceExporter when Export Workspace is clicked', async () => {
			const onShowWorkspaceExporter = vi.fn();
			const ws = makeWorkspace();
			render(EditorNavigation, {
				props: { ...defaultProps, availableWorkspaces: [ws], onShowWorkspaceExporter }
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Export Workspace' }));
			expect(onShowWorkspaceExporter).toHaveBeenCalledOnce();
		});

		it('calls onShowDifficultyModal when Switch Difficulty is clicked', async () => {
			const onShowDifficultyModal = vi.fn();
			render(EditorNavigation, {
				props: {
					...defaultProps,
					simfileID: 'some-id',
					hasSimfile: true,
					onShowDifficultyModal
				}
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Switch Difficulty' }));
			expect(onShowDifficultyModal).toHaveBeenCalledOnce();
		});
	});

	describe('isPreviewing disabling', () => {
		it('disables New button when isPreviewing is true', () => {
			render(EditorNavigation, { props: { ...defaultProps, isPreviewing: true } });
			expect(screen.getByRole('button', { name: 'New' })).toBeDisabled();
		});

		it('disables Import File button when isPreviewing is true', () => {
			render(EditorNavigation, { props: { ...defaultProps, isPreviewing: true } });
			expect(screen.getByRole('button', { name: 'Import File' })).toBeDisabled();
		});

		it('disables Export File button when isPreviewing is true', () => {
			render(EditorNavigation, { props: { ...defaultProps, isPreviewing: true } });
			expect(screen.getByRole('button', { name: 'Export File' })).toBeDisabled();
		});

		it('disables Manage Sound files library button when isPreviewing is true', () => {
			render(EditorNavigation, { props: { ...defaultProps, isPreviewing: true } });
			expect(
				screen.getByRole('button', { name: 'Manage Sound files library' })
			).toBeDisabled();
		});

		it('disables Switch Difficulty button when isPreviewing is true and simfileID is set', () => {
			render(EditorNavigation, {
				props: {
					...defaultProps,
					simfileID: 'some-id',
					hasSimfile: true,
					isPreviewing: true
				}
			});
			expect(screen.getByRole('button', { name: 'Switch Difficulty' })).toBeDisabled();
		});
	});
});
