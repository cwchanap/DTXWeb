<script lang="ts">
	import {
		ChevronRight,
		ChevronDown,
		Folder,
		FolderOpen,
		Loader,
		Music,
		Link,
		Unlink
	} from '@lucide/svelte';
	import { workspaceService } from '../services/workspaceService';
	import { linkingService } from '../services/linkingService';
	import type { TreeNode } from '../stores/workspaceStore';
	import WorkspaceTree from './WorkspaceTree.svelte';

	interface Props {
		nodes: TreeNode[];
		level?: number;
	}

	let { nodes, level = 0 }: Props = $props();

	const handleToggleNode = async (node: TreeNode) => {
		if (node.isLoading) return;

		// Handle song selection for folders containing .dtx files
		if (node.containsDtxFiles) {
			handleSongSelect(node);
			return;
		}

		try {
			if (node.isExpanded) {
				workspaceService.collapseTreeNode(node.path);
			} else {
				await workspaceService.expandTreeNode(node.path);
			}
		} catch (error) {
			console.error('Error toggling tree node:', error);
		}
	};

	const handleSongSelect = (song: TreeNode) => {
		workspaceService.selectSong(song);
	};

	const handleUnlinkFolder = (event: Event, node: TreeNode) => {
		event.stopPropagation(); // Prevent triggering the folder click
		linkingService.unlinkSimFileFromFolder(node.path);
	};

	const getIndentStyle = (level: number) => {
		return `padding-left: ${level * 20}px`;
	};
</script>

{#each nodes as node}
	<div class="tree-node">
		<div class="flex w-full items-center gap-2">
			<button
				class="flex flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors {node.containsDtxFiles
					? node.linkedSimFileId
						? 'hover:bg-green/10 cursor-pointer'
						: 'hover:bg-surface-2 cursor-pointer'
					: 'hover:bg-surface-2'}"
				style={getIndentStyle(level)}
				onclick={() => handleToggleNode(node)}
				disabled={node.isLoading}
			>
				<!-- Expand/Collapse Icon -->
				<div class="flex h-4 w-4 items-center justify-center">
					{#if node.isLoading}
						<Loader size={12} class="text-dim animate-spin" />
					{:else if node.hasChildren && !node.containsDtxFiles}
						{#if node.isExpanded}
							<ChevronDown size={14} class="text-dim" />
						{:else}
							<ChevronRight size={14} class="text-dim" />
						{/if}
					{:else}
						<!-- Empty space for alignment -->
						<div class="h-4 w-4"></div>
					{/if}
				</div>

				<!-- Folder/Song Icon -->
				{#if node.containsDtxFiles}
					<Music size={16} class={node.linkedSimFileId ? 'text-green' : 'text-cyan'} />
				{:else if node.isExpanded}
					<FolderOpen size={16} class="text-cyan" />
				{:else}
					<Folder size={16} class="text-cyan" />
				{/if}

				<!-- Folder Name and Song Title -->
				<div class="flex flex-1 flex-col truncate">
					<span class="text-base-text truncate">{node.name}</span>
					{#if node.songTitle}
						<span class="text-faint truncate text-xs italic">
							{node.songTitle}
						</span>
					{/if}
				</div>

				<!-- Linked Indicator -->
				{#if node.containsDtxFiles && node.linkedSimFileId}
					<div class="flex items-center gap-1">
						<Link size={12} class="text-green" />
						<span class="text-green text-xs">Linked</span>
					</div>
				{/if}
			</button>

			<!-- Unlink Button (outside main button) -->
			{#if node.containsDtxFiles && node.linkedSimFileId}
				<button
					class="border-red/40 bg-red/10 text-red hover:bg-red/20 flex h-5 w-5 items-center justify-center rounded-full"
					onclick={(event) => handleUnlinkFolder(event, node)}
					title="Unlink from cloud"
					aria-label="Unlink folder from cloud simFile"
				>
					<Unlink size={10} />
				</button>
			{/if}
		</div>

		<!-- Render children if expanded (but not for folders containing .dtx files) -->
		{#if node.isExpanded && node.children.length > 0 && !node.containsDtxFiles}
			<WorkspaceTree nodes={node.children} level={level + 1} />
		{/if}
	</div>
{/each}

<style>
	.tree-node {
		user-select: none;
	}
</style>
