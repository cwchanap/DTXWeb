<script lang="ts">
	import { authStore } from '../../stores/authStore';
	import { workspaceStore, type TreeNode } from '../../stores/workspaceStore';
	import { simFileStore } from '../../stores/simFileStore';
	import { authService } from '../../services/authService';
	import { simFileService } from '../../services/simFileService';
	import { workspaceService } from '../../services/workspaceService';
	import { exportSelectedSong } from '../../services/exportService';
	import { buildCommands, type Command } from '../../commands/commands';
	import { searchItems } from '../../lib/fuzzy';
	import type { SimfileWithDtx } from '@dtx/common';

	type FlatResult =
		| { kind: 'command'; c: Command }
		| { kind: 'song'; s: TreeNode }
		| { kind: 'cloud'; s: SimfileWithDtx };

	interface Props {
		open: boolean;
		onClose: () => void;
	}
	let { open, onClose }: Props = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();
	let listEl: HTMLUListElement | undefined = $state();

	// Combobox/listbox wiring (spec §7: focus trap, role="dialog", aria-activedescendant).
	const listboxId = 'cmd-palette-list';
	const optionId = (i: number) => `cmd-opt-${i}`;

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
		logout: () => void authService.logout(),
		exportSelected: () => void exportSelectedSong()
	};

	const flatten = (nodes: TreeNode[], acc: TreeNode[] = []): TreeNode[] => {
		for (const n of nodes) {
			if (n.containsDtxFiles) acc.push(n);
			flatten(n.children, acc);
		}
		return acc;
	};

	const commands = $derived(
		buildCommands({
			isAuthenticated: $authStore.isAuthenticated,
			hasSelectedSong: !!$workspaceStore.selectedSong,
			handlers
		})
	);
	const songs = $derived(flatten($workspaceStore.treeStructure));
	const cloudSongs = $derived($simFileStore.userSimFiles);
	const cmdResults = $derived(searchItems(query, commands, (c) => c.title));
	const songResults = $derived(
		searchItems(query, songs, (s) => s.songTitle || s.name).slice(0, 8)
	);
	const cloudResults = $derived(searchItems(query, cloudSongs, (s) => s.title).slice(0, 8));
	const flatResults = $derived<FlatResult[]>([
		...cmdResults.map((c) => ({ kind: 'command' as const, c })),
		...songResults.map((s) => ({ kind: 'song' as const, s })),
		...cloudResults.map((s) => ({ kind: 'cloud' as const, s }))
	]);
	// Points the combobox's aria-activedescendant at the active option.
	const activeId = $derived(flatResults.length > 0 ? optionId(selected) : undefined);

	const keyOf = (r: FlatResult): string =>
		r.kind === 'command' ? r.c.id : r.kind === 'song' ? r.s.path : `cloud-${r.s.id}`;
	const labelOf = (r: FlatResult): string =>
		r.kind === 'command'
			? r.c.title
			: r.kind === 'song'
				? r.s.songTitle || r.s.name
				: r.s.title;
	const tagOf = (r: FlatResult): string =>
		r.kind === 'command' ? r.c.group.toUpperCase() : r.kind === 'song' ? 'SONG' : 'CLOUD';

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

	// Keep the active option in view during arrow-key navigation.
	$effect(() => {
		selected; // track
		if (!listEl) return;
		const active = listEl.querySelector('[aria-selected="true"]');
		// Guard: some test/older environments lack Element.scrollIntoView.
		if (active && typeof active.scrollIntoView === 'function') {
			active.scrollIntoView({ block: 'nearest' });
		}
	});

	const runAt = (i: number) => {
		const r = flatResults[i];
		if (!r) return;
		if (r.kind === 'command') {
			r.c.run();
		} else if (r.kind === 'song') {
			workspaceStore.setActiveSection('library');
			workspaceStore.selectSong(r.s);
		} else {
			workspaceStore.setActiveSection('cloud');
			workspaceStore.selectCloudSimFile(r.s);
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
		} else if (e.key === 'Tab') {
			// Focus trap (spec §7): the combobox input is the only tab-stop in the
			// dialog — options are announced via aria-activedescendant, not focus.
			// Prevent Tab from escaping the modal so keyboard focus stays inside.
			e.preventDefault();
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
			aria-label="Command palette"
			tabindex="-1"
		>
			<input
				bind:this={inputEl}
				bind:value={query}
				role="combobox"
				aria-expanded="true"
				aria-haspopup="listbox"
				aria-controls={listboxId}
				aria-activedescendant={activeId}
				aria-autocomplete="list"
				aria-label="Command palette search"
				class="bg-surface-2 font-mono-alt text-hi w-full px-4 py-3 text-sm outline-none"
				placeholder="Search songs or run a command…"
			/>
			<ul
				id={listboxId}
				bind:this={listEl}
				role="listbox"
				aria-label="Commands and songs"
				class="max-h-80 overflow-auto py-2"
			>
				{#each flatResults as r, i (keyOf(r))}
					<li
						id={optionId(i)}
						role="option"
						aria-selected={i === selected}
						class="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left text-sm"
						class:bg-surface-3={i === selected}
						aria-label={labelOf(r)}
						onclick={() => runAt(i)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								runAt(i);
							}
						}}
					>
						<span class={r.kind === 'command' ? 'text-hi' : 'text-cyan'}>
							{labelOf(r)}
						</span>
						<span class="font-display text-faint text-[10px] tracking-widest">
							{tagOf(r)}
						</span>
					</li>
				{/each}
				{#if flatResults.length === 0}
					<li role="presentation" class="text-faint px-4 py-3 text-sm">No results</li>
				{/if}
			</ul>
		</div>
	</div>
{/if}
