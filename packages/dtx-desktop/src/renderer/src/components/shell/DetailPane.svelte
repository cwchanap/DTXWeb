<script lang="ts">
	import { Music } from '@lucide/svelte';
	import { workspaceStore } from '../../stores/workspaceStore';
	import SongDetails from '../SongDetails.svelte';
	import CloudSongDetail from '../CloudSongDetail.svelte';
</script>

<div class="bg-surface-1 h-full overflow-auto">
	{#if $workspaceStore.selectedSong}
		<SongDetails song={$workspaceStore.selectedSong} />
	{:else if $workspaceStore.selectedCloudSimFile}
		<CloudSongDetail simFile={$workspaceStore.selectedCloudSimFile} />
	{:else}
		<div class="text-faint flex h-full flex-col items-center justify-center gap-3">
			<Music size={40} />
			<p class="font-display text-sm tracking-widest">SELECT A SONG TO SEE DETAILS</p>
		</div>
	{/if}
</div>
