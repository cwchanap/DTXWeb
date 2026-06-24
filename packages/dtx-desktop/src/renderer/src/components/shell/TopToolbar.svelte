<script lang="ts">
	import { authStore } from '../../stores/authStore';
	import { workspaceStore } from '../../stores/workspaceStore';
	import { preferencesStore } from '../../stores/preferencesStore';
	import { authService } from '../../services/authService';
	import { simFileService } from '../../services/simFileService';
	import { Music, LogOut, User, RefreshCw, Search, PanelRight } from '@lucide/svelte';

	interface Props {
		onOpenPalette: () => void;
	}
	let { onOpenPalette }: Props = $props();

	let isClearing = $state(false);
	const isListSection = $derived(
		$workspaceStore.activeSection === 'library' || $workspaceStore.activeSection === 'cloud'
	);

	const handleLogout = async () => {
		await authService.logout();
	};
	const handleClearCache = async () => {
		isClearing = true;
		try {
			simFileService.clearCache();
			localStorage.removeItem('song_templates');
		} finally {
			setTimeout(() => (isClearing = false), 1000);
		}
	};
	const handleToggleDetail = () => preferencesStore.toggleDetail();
	const handleLogin = () => authService.login();
</script>

<header class="border-hairline bg-surface-1 flex h-12 items-center gap-3 border-b px-4">
	<div class="flex items-center gap-2">
		<Music size={18} class="text-magenta" />
		<span class="font-display text-hi text-sm font-bold tracking-[0.18em]">DRUMERY</span>
	</div>

	<button
		class="border-hairline bg-surface-2 text-dim hover:border-cyan ml-4 flex h-8 max-w-md flex-1 items-center gap-2 rounded-lg border px-3 text-xs transition-colors"
		onclick={onOpenPalette}
		aria-label="Open command palette"
	>
		<Search size={14} />
		<span class="font-mono-alt">⌘K · search songs or run a command</span>
	</button>

	<div class="ml-auto flex items-center gap-3">
		{#if isListSection}
			<button
				class="bg-surface-2 text-dim hover:text-hi flex items-center rounded-lg px-2 py-1 text-xs"
				class:text-cyan={$preferencesStore.detailPaneVisible}
				onclick={handleToggleDetail}
				aria-label="Toggle details panel"
				aria-pressed={$preferencesStore.detailPaneVisible}
				disabled={!$preferencesStore.loaded}
			>
				<PanelRight size={14} />
			</button>
		{/if}
		{#if $authStore.isAuthenticated}
			<div class="text-right leading-tight">
				<p class="text-hi text-xs font-medium">{$authStore.user?.name || 'User'}</p>
				<p class="font-mono-alt text-dim text-[10px]">{$authStore.user?.email}</p>
			</div>
			<button
				class="bg-surface-2 text-cyan hover:border-cyan flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
				onclick={handleClearCache}
				disabled={isClearing}
				aria-label="Clear cache"
			>
				<RefreshCw size={13} class={isClearing ? 'animate-spin' : ''} />
				{isClearing ? 'Clearing…' : 'Clear Cache'}
			</button>
			<button
				class="bg-surface-2 text-red hover:text-hi flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
				onclick={handleLogout}
				aria-label="Logout"><LogOut size={13} /> Logout</button
			>
		{:else}
			<button
				class="bg-magenta font-display flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-[#16001a]"
				style="box-shadow:0 0 22px -6px var(--color-magenta)"
				onclick={handleLogin}
				aria-label="Login to access cloud features"
			>
				<User size={14} /> Login
			</button>
		{/if}
	</div>
</header>
