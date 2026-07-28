<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { googleDriveService } from '../services/googleDriveService';
	import { googleDriveStore } from '../stores/googleDriveStore';
	import { authStore } from '../stores/authStore';

	let busy = $state(false);

	const run = async (action: () => Promise<unknown>) => {
		if (busy) return;
		busy = true;
		try {
			await action();
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		if ($authStore.isAuthenticated) void googleDriveService.refreshConnection();
	});
</script>

{#if $authStore.isAuthenticated}
	<section
		class="border-hairline mt-6 space-y-3 border-t pt-6"
		aria-labelledby="google-drive-title"
	>
		<h4 id="google-drive-title" class="text-base-text text-sm font-medium">
			{$_('googleDrive.title')}
		</h4>

		{#if $googleDriveStore.connection?.connected}
			<p class="text-green text-sm">{$_('googleDrive.connected')}</p>
			{#if $googleDriveStore.connection.folder}
				<p class="text-dim text-sm">
					{$_('googleDrive.folder', {
						values: { name: $googleDriveStore.connection.folder.name }
					})}
				</p>
			{/if}
		{:else}
			<p class="text-dim text-sm">{$_('googleDrive.disconnected')}</p>
		{/if}

		<div aria-live="polite" class="space-y-1">
			{#if $googleDriveStore.connection?.requiresReconnect}
				<p class="text-yellow text-sm">{$_('googleDrive.warning.reconnect')}</p>
			{/if}
			{#if $googleDriveStore.connection?.credentialStoreUnavailable}
				<p class="text-yellow text-sm">{$_('googleDrive.warning.credentialStore')}</p>
			{/if}
			{#if $googleDriveStore.connection?.requiresPublicSharing}
				<p class="text-yellow text-sm">{$_('googleDrive.warning.privateSharing')}</p>
			{/if}
			{#if $googleDriveStore.connection?.sharingCheckUnavailable}
				<p class="text-yellow text-sm">{$_('googleDrive.warning.sharingCheck')}</p>
			{/if}
			{#if $googleDriveStore.connection?.connected && $googleDriveStore.publicDownloadVerified}
				<p class="text-green text-sm">{$_('googleDrive.verifiedPublic')}</p>
			{/if}
			{#if $googleDriveStore.connection?.connected && !$googleDriveStore.connection.credentialStoreUnavailable}
				<p class="text-dim text-sm">{$_('googleDrive.warning.existingFileAccess')}</p>
				<p class="text-dim text-sm">{$_('googleDrive.folderConsent')}</p>
			{/if}
			{#if $googleDriveStore.revocationUnconfirmed}
				<p class="text-yellow text-sm">{$_('googleDrive.revocationUnconfirmed')}</p>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2">
			{#if $googleDriveStore.connection?.credentialStoreUnavailable}
				<button
					class="bg-magenta rounded-lg px-3 py-2 text-sm disabled:opacity-50"
					onclick={() => run(googleDriveService.refreshConnection)}
					disabled={busy}
				>
					{$_('googleDrive.action.refresh')}
				</button>
			{:else if !$googleDriveStore.connection?.connected || $googleDriveStore.connection?.requiresReconnect}
				<button
					class="bg-magenta rounded-lg px-3 py-2 text-sm disabled:opacity-50"
					onclick={() => run(googleDriveService.connectAndChooseFolder)}
					disabled={busy}
				>
					{busy ? $_('googleDrive.connecting') : $_('googleDrive.connect')}
				</button>
			{:else}
				<button
					class="border-hairline rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
					onclick={() => run(googleDriveService.changeFolder)}
					disabled={busy}
				>
					{$_('googleDrive.changeFolder')}
				</button>
				<button
					class="border-hairline rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
					onclick={() => run(googleDriveService.recheckSharing)}
					disabled={busy}
				>
					{$_('googleDrive.recheckSharing')}
				</button>
				<button
					class="text-dim rounded-lg px-3 py-2 text-sm disabled:opacity-50"
					onclick={() => run(googleDriveService.disconnect)}
					disabled={busy}
				>
					{$_('googleDrive.disconnect')}
				</button>
			{/if}
		</div>
	</section>
{/if}
