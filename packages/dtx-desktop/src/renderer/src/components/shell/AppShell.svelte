<script lang="ts">
	import TopToolbar from './TopToolbar.svelte';
	import Login from '$lib/components/Login.svelte';
	import NavRail from './NavRail.svelte';
	import DetailPane from './DetailPane.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import Workspace from '../Workspace.svelte';
	import SimFileList from '../SimFileList.svelte';
	import Templates from '../Templates.svelte';
	import Settings from '../Settings.svelte';
	import Scores from '../Scores.svelte';
	import NewSong from '../NewSong.svelte';
	import { workspaceStore } from '../../stores/workspaceStore';
	import { authStore } from '../../stores/authStore';
	import {
		preferencesStore,
		clampWidth as clampDetailWidth
	} from '../../stores/preferencesStore';
	import { resolveShellMode } from '../../lib/shellMode';
	import { authService } from '../../services/authService';
	import { onMount, untrack } from 'svelte';

	let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let paletteOpen = $state(false);
	const mode = $derived(resolveShellMode(width));
	const section = $derived($workspaceStore.activeSection);
	const isListSection = $derived(section === 'library' || section === 'cloud');
	const detailVisible = $derived($preferencesStore.detailPaneVisible);
	const hasSelection = $derived(
		!!$workspaceStore.selectedSong || !!$workspaceStore.selectedCloudSimFile
	);
	const showDetail = $derived(isListSection && hasSelection && detailVisible);

	// The Cloud section is auth-only: NavRail hides its button when signed out,
	// but activeSection is left untouched, so it would otherwise stay 'cloud'
	// and keep rendering the cloud list for a signed-out session. Reset to the
	// local library so the master pane always reflects an accessible section.
	$effect(() => {
		if (
			!$authStore.isAuthenticated &&
			($workspaceStore.activeSection === 'cloud' ||
				$workspaceStore.activeSection === 'scores')
		) {
			workspaceStore.setActiveSection('library');
		}
	});

	// Auto-reveal the detail pane when a song is selected from the library or
	// cloud list. Without this, clicking a song while the pane was previously
	// hidden leaves the selection silently invisible until the user toggles the
	// pane back open. The reveal fires only on a genuinely new selection: the
	// effect does not subscribe to detailPaneVisible (read via untrack), so
	// hiding the pane while a song stays selected doesn't immediately re-trigger
	// it. setDetailVisible is a no-op before preferences have loaded.
	let prevSelectionKey: string | number | null = null;
	$effect(() => {
		const selectionKey =
			$workspaceStore.selectedSong?.path ?? $workspaceStore.selectedCloudSimFile?.id ?? null;
		if (!$preferencesStore.loaded) return;
		const isNewSelection =
			isListSection && selectionKey !== null && selectionKey !== prevSelectionKey;
		prevSelectionKey = selectionKey;
		if (!isNewSelection) return;
		if (!untrack(() => $preferencesStore.detailPaneVisible)) {
			preferencesStore.setDetailVisible(true);
		}
	});

	const clampDetail = clampDetailWidth;
	let isDraggingDetail = $state(false);
	let dragDetailWidth = $state(420);

	// Escape dismisses the sign-in surface: cancel any pending device flow and
	// close the dialog so the keyboard can always escape the modal.
	const handleShellKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && $authStore.isLoginVisible) {
			event.preventDefault();
			void authService.cancelLogin();
		}
	};

	const detailRenderWidth = $derived(
		isDraggingDetail ? dragDetailWidth : $preferencesStore.detailPaneWidth
	);

	const handleDetailResizeMove = (e: MouseEvent) => {
		if (!isDraggingDetail) return;
		dragDetailWidth = clampDetail(window.innerWidth - e.clientX);
	};
	const handleDetailResizeUp = () => {
		isDraggingDetail = false;
		document.removeEventListener('mousemove', handleDetailResizeMove);
		document.removeEventListener('mouseup', handleDetailResizeUp);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		if (dragDetailWidth !== $preferencesStore.detailPaneWidth) {
			preferencesStore.setDetailWidth(dragDetailWidth);
		}
	};
	const handleDetailResizeDown = (e: MouseEvent) => {
		e.preventDefault();
		dragDetailWidth = $preferencesStore.detailPaneWidth;
		isDraggingDetail = true;
		document.addEventListener('mousemove', handleDetailResizeMove);
		document.addEventListener('mouseup', handleDetailResizeUp);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	};
	const handleDetailResizeKey = (e: KeyboardEvent) => {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			preferencesStore.setDetailWidth($preferencesStore.detailPaneWidth + 20);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			preferencesStore.setDetailWidth($preferencesStore.detailPaneWidth - 20);
		}
	};

	let rootEl: HTMLElement;
	onMount(() => {
		void preferencesStore.load();
		const ro = new ResizeObserver((entries) => {
			width = entries[0].contentRect.width;
		});
		ro.observe(rootEl);
		return () => {
			ro.disconnect();
			// If the component tears down while a drag is in progress, drop the document
			// listeners and restore body styles so nothing leaks behind.
			document.removeEventListener('mousemove', handleDetailResizeMove);
			document.removeEventListener('mouseup', handleDetailResizeUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		};
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			paletteOpen = true;
		}
		handleShellKeydown(e);
	}}
/>

<div bind:this={rootEl} class="bg-base text-base-text flex h-screen flex-col">
	<TopToolbar onOpenPalette={() => (paletteOpen = true)} />
	<div class="flex min-h-0 flex-1">
		<NavRail />
		<div class="flex min-h-0 flex-1">
			{#if section === 'settings'}
				<Settings />
			{:else if section === 'templates'}
				<Templates />
			{:else if section === 'scores'}
				<Scores />
			{:else if $workspaceStore.showNewSong}
				<NewSong />
			{:else}
				<!-- master pane -->
				<div
					data-testid="master-pane"
					class="reveal border-hairline min-w-0 flex-1 overflow-auto border-r"
					class:hidden={mode !== 'wide' && showDetail}
				>
					{#if section === 'cloud'}<SimFileList />{:else}<Workspace />{/if}
				</div>
				<!-- detail pane -->
				{#if showDetail}
					<div
						class="reveal reveal-1 relative min-w-0"
						class:flex-1={mode !== 'wide'}
						style={mode === 'wide' ? `width:${detailRenderWidth}px` : ''}
					>
						{#if mode === 'wide'}
							<button
								type="button"
								class="hover:bg-cyan/40 focus-visible:ring-cyan/40 absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize focus-visible:ring-2 focus-visible:outline-none"
								class:bg-cyan={isDraggingDetail}
								onmousedown={handleDetailResizeDown}
								onkeydown={handleDetailResizeKey}
								aria-label="Resize details panel"
							></button>
						{/if}
						<DetailPane />
					</div>
				{/if}
			{/if}
		</div>
	</div>
	<CommandPalette open={paletteOpen} onClose={() => (paletteOpen = false)} />
	{#if $authStore.isLoginVisible}
		<div class="sign-in-overlay" role="presentation">
			<div class="sign-in-dialog" role="dialog" aria-modal="true" aria-label="Sign in">
				<Login />
			</div>
		</div>
	{/if}
</div>

<style>
	@reference '../../assets/base.css';

	.sign-in-overlay {
		@apply fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh];
	}
	.sign-in-dialog {
		@apply border-hairline bg-surface-1 w-full max-w-xl overflow-hidden rounded-2xl border;
	}
</style>
