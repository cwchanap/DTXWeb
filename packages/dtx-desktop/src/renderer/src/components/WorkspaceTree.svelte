<script lang="ts">
	import { ChevronRight, ChevronDown, Folder, FolderOpen, Loader } from '@lucide/svelte';
	import { workspaceService } from '../services/workspaceService';
	import type { TreeNode } from '../stores/workspaceStore';
	import WorkspaceTree from './WorkspaceTree.svelte';

	interface Props {
		nodes: TreeNode[];
		level?: number;
	}

	let { nodes, level = 0 }: Props = $props();

	const handleToggleNode = async (node: TreeNode) => {
		if (node.isLoading) return;

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

	const getIndentStyle = (level: number) => {
		return `padding-left: ${level * 20}px`;
	};
</script>

{#each nodes as node}
	<div class="tree-node">
		<button
			class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
			style={getIndentStyle(level)}
			onclick={() => handleToggleNode(node)}
			disabled={node.isLoading}
		>
			<!-- Expand/Collapse Icon -->
			<div class="flex h-4 w-4 items-center justify-center">
				{#if node.isLoading}
					<Loader size={12} class="animate-spin text-slate-500" />
				{:else if node.hasChildren}
					{#if node.isExpanded}
						<ChevronDown size={14} class="text-slate-500" />
					{:else}
						<ChevronRight size={14} class="text-slate-500" />
					{/if}
				{:else}
					<!-- Empty space for alignment -->
					<div class="h-4 w-4"></div>
				{/if}
			</div>

			<!-- Folder Icon -->
			{#if node.isExpanded}
				<FolderOpen size={16} class="text-blue-500 dark:text-blue-400" />
			{:else}
				<Folder size={16} class="text-blue-500 dark:text-blue-400" />
			{/if}

			<!-- Folder Name -->
			<span class="truncate text-slate-700 dark:text-slate-300">{node.name}</span>
		</button>

		<!-- Render children if expanded -->
		{#if node.isExpanded && node.children.length > 0}
			<WorkspaceTree nodes={node.children} level={level + 1} />
		{/if}
	</div>
{/each}

<style>
	.tree-node {
		user-select: none;
	}
</style>
