<script lang="ts">
	import { HardDrive, Cloud, FileText, Settings, Trophy } from '@lucide/svelte';
	import { authStore } from '../../stores/authStore';
	import { workspaceStore, type ShellSection } from '../../stores/workspaceStore';

	type Item = { id: ShellSection; label: string; icon: typeof HardDrive; authOnly?: boolean };

	const items: Item[] = [
		{ id: 'library', label: 'Library', icon: HardDrive },
		{ id: 'cloud', label: 'Cloud', icon: Cloud, authOnly: true },
		{ id: 'scores', label: 'Scores', icon: Trophy, authOnly: true },
		{ id: 'templates', label: 'Templates', icon: FileText },
		{ id: 'settings', label: 'Settings', icon: Settings }
	];

	const visible = $derived(items.filter((i) => !i.authOnly || $authStore.isAuthenticated));
	const handleSelect = (id: ShellSection) => workspaceStore.setActiveSection(id);
</script>

<nav
	class="border-hairline bg-surface-1 flex h-full w-16 flex-col items-center gap-2 border-r py-4 md:w-20"
>
	{#each visible as item (item.id)}
		<button
			class="font-display text-dim hover:text-hi flex w-16 flex-col items-center gap-1.5 rounded-xl py-3 text-[10px] tracking-widest transition-colors"
			class:active={$workspaceStore.activeSection === item.id}
			onclick={() => handleSelect(item.id)}
			aria-label={item.label}
			aria-current={$workspaceStore.activeSection === item.id ? 'page' : undefined}
		>
			<item.icon size={24} />
			<span class="hidden md:inline">{item.label.toUpperCase()}</span>
		</button>
	{/each}
</nav>

<style>
	.active {
		color: var(--color-magenta);
		background: var(--color-surface-2);
		box-shadow:
			inset 3px 0 0 var(--color-magenta),
			0 0 24px -12px var(--color-magenta);
	}
</style>
