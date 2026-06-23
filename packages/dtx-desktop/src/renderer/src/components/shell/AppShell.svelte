<script lang="ts">
	import TopToolbar from './TopToolbar.svelte';
	import NavRail from './NavRail.svelte';
	import DetailPane from './DetailPane.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import Workspace from '../Workspace.svelte';
	import SimFileList from '../SimFileList.svelte';
	import Templates from '../Templates.svelte';
	import Settings from '../Settings.svelte';
	import NewSong from '../NewSong.svelte';
	import { workspaceStore } from '../../stores/workspaceStore';
	import { preferencesStore } from '../../stores/preferencesStore';
	import { resolveShellMode } from '../../lib/shellMode';
	import { onMount } from 'svelte';

	let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let paletteOpen = $state(false);
	const mode = $derived(resolveShellMode(width));
	const section = $derived($workspaceStore.activeSection);
	const isListSection = $derived(section === 'library' || section === 'cloud');
	const detailVisible = $derived($preferencesStore.detailPaneVisible);
	const showDetail = $derived(isListSection && !!$workspaceStore.selectedSong && detailVisible);

	const MIN_DETAIL = 320;
	const MAX_DETAIL = 640;
	const clampDetail = (w: number) => Math.min(Math.max(w, MIN_DETAIL), MAX_DETAIL);
	let isDraggingDetail = $state(false);
	let dragDetailWidth = $state(420);
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
		return () => ro.disconnect();
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			paletteOpen = true;
		}
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
			{:else if $workspaceStore.showNewSong}
				<NewSong />
			{:else}
				<!-- master pane -->
				<div
					class="reveal border-hairline min-w-0 flex-1 overflow-auto border-r"
					class:hidden={mode === 'narrow' && showDetail}
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
								class="hover:bg-cyan/40 absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize"
								class:bg-cyan={isDraggingDetail}
								onmousedown={handleDetailResizeDown}
								onkeydown={handleDetailResizeKey}
								tabindex="0"
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
</div>
