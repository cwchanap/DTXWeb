<script lang="ts">
	import { authStore } from '../../stores/authStore';
	import { workspaceStore, type TreeNode } from '../../stores/workspaceStore';
	import { authService } from '../../services/authService';
	import { simFileService } from '../../services/simFileService';
	import { workspaceService } from '../../services/workspaceService';
	import { buildCommands } from '../../commands/commands';
	import { searchItems } from '../../lib/fuzzy';

	interface Props {
		open: boolean;
		onClose: () => void;
	}
	let { open, onClose }: Props = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();

	const handlers = {
		goToSection: (s: Parameters<typeof workspaceStore.setActiveSection>[0]) =>
			workspaceStore.setActiveSection(s),
		newSong: () => workspaceStore.showNewSongForm(),
		selectWorkspace: () => void workspaceService.selectWorkspace(),
		refreshWorkspace: () => {
			void workspaceService.loadSubWorkspaces();
			void workspaceService.loadTreeStructure();
		},
		clearWorkspace: () => workspaceService.clearWorkspace(),
		clearCache: () => {
			simFileService.clearCache();
			localStorage.removeItem('song_templates');
		},
		login: () => void authService.login(),
		logout: () => void authService.logout()
	};

	const flatten = (nodes: TreeNode[], acc: TreeNode[] = []): TreeNode[] => {
		for (const n of nodes) {
			if (n.containsDtxFiles) acc.push(n);
			flatten(n.children, acc);
		}
		return acc;
	};

	const commands = $derived(
		buildCommands({ isAuthenticated: $authStore.isAuthenticated, handlers })
	);
	const songs = $derived(flatten($workspaceStore.treeStructure));
	const cmdResults = $derived(searchItems(query, commands, (c) => c.title));
	const songResults = $derived(
		searchItems(query, songs, (s) => s.songTitle || s.name).slice(0, 8)
	);
	const flatResults = $derived([
		...cmdResults.map((c) => ({ kind: 'command' as const, c })),
		...songResults.map((s) => ({ kind: 'song' as const, s }))
	]);

	$effect(() => {
		if (open) {
			query = '';
			selected = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});

	$effect(() => {
		query; // track query
		selected = 0;
	});

	const runAt = (i: number) => {
		const r = flatResults[i];
		if (!r) return;
		if (r.kind === 'command') r.c.run();
		else {
			workspaceStore.setActiveSection('library');
			workspaceStore.selectSong(r.s);
		}
		onClose();
	};

	const handleKey = (e: KeyboardEvent) => {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, flatResults.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			runAt(selected);
		}
	};
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={(e) => {
			if (e.target === e.currentTarget && e.key === 'Escape') onClose();
		}}
		role="presentation"
	>
		<div
			class="border-hairline bg-surface-1 w-full max-w-xl overflow-hidden rounded-2xl border"
			style="box-shadow:0 0 60px -12px var(--color-magenta)"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<input
				bind:this={inputEl}
				bind:value={query}
				role="textbox"
				class="bg-surface-2 font-mono-alt text-hi w-full px-4 py-3 text-sm outline-none"
				placeholder="Search songs or run a command…"
				aria-label="Command palette search"
			/>
			<ul class="max-h-80 overflow-auto py-2">
				{#each flatResults as r, i (r.kind === 'command' ? r.c.id : r.s.path)}
					<li>
						<button
							class="flex w-full items-center justify-between px-4 py-2 text-left text-sm"
							class:bg-surface-3={i === selected}
							onclick={() => runAt(i)}
						>
							<span class={r.kind === 'command' ? 'text-hi' : 'text-cyan'}>
								{r.kind === 'command' ? r.c.title : r.s.songTitle || r.s.name}
							</span>
							<span class="font-display text-faint text-[10px] tracking-widest">
								{r.kind === 'command' ? r.c.group.toUpperCase() : 'SONG'}
							</span>
						</button>
					</li>
				{/each}
				{#if flatResults.length === 0}
					<li class="text-faint px-4 py-3 text-sm">No results</li>
				{/if}
			</ul>
		</div>
	</div>
{/if}
