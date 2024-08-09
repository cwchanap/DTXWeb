<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Tables } from '@/types/supabase.types';
	import { goto } from '$app/navigation';
	import { getToastStore } from '@skeletonlabs/skeleton';

	const toastStore = getToastStore();

	let simfile: Tables<'simfiles'> | null = null;
	let loading = true;
	let error: string | null = null;
	let downloadLink: string | null = null;
	let videoPreviewLink: string | null = null;

	onMount(async () => {
		const { id } = $page.params;
		await loadSimfileDetails(id);
	});

	async function loadSimfileDetails(id: string) {
		try {
			const { data, error: fetchError } = await supabase
				.from('simfiles')
				.select('*, dtx_files(level)')
				.eq('id', id)
				.single();

			if (fetchError) throw fetchError;
			simfile = data;
			downloadLink = data?.download_url;
			videoPreviewLink = data?.video_preview_url;
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	function goBack() {
		goto('/app/chart');
	}

	async function updateSimfile() {
		const { id } = $page.params;
		const { data, error } = await supabase
			.from('simfiles')
			.update({ download_url: downloadLink, video_preview_url: videoPreviewLink })
			.eq('id', id)
			.select();

		if (!data || error) {
			toastStore.trigger({
				message: 'Error updating simfile',
				background: 'variant-filled-error',
				timeout: 5000
			});
		} else {
			toastStore.trigger({
				message: 'Simfile updated successfully',
				background: 'variant-filled-success',
				timeout: 5000
			});
		}
	}
</script>

<div class="container mx-auto p-4">
	<button on:click={goBack} class="mb-4 text-blue-500 hover:text-blue-700">
		&larr; Back to List
	</button>
	{#if loading}
		<p>Loading...</p>
	{:else if error}
		<p class="text-red-500">Error: {error}</p>
	{:else if simfile}
		<div class="flex-grow rounded-lg bg-white p-6 shadow-md">
			<h1 class="mb-4 text-2xl font-bold">{simfile.title}</h1>
			<div class="grid grid-cols-2 gap-4">
				<div>
					<p><span class="font-semibold"> BPM: </span>{simfile.bpm}</p>
				</div>
				<div>
					<p><span class="font-semibold"> Artist: </span>{simfile.artist || 'N/A'}</p>
				</div>
			</div>
			<div class="mt-4">
				<p>
					<span class="font-semibold"> Level: </span>{simfile.dtx_files
						?.map((file) => file.level)
						.join(' / ') || 'N/A'}
				</p>
			</div>
			<div class="mt-4">
				<label for="download_line" class="mb-2 block">Download Link:</label>

				<input
					id="download_line"
					type="text"
					bind:value={downloadLink}
					class="mb-4 w-full rounded border p-2"
				/>

				<label for="video_preview_link" class="mb-2 block">Video Preview Link:</label>
				<input
					id="video_preview_link"
					type="text"
					bind:value={videoPreviewLink}
					class="w-full rounded border p-2"
				/>
			</div>

			<button
				on:click={updateSimfile}
				class="mt-4 rounded bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700"
			>
				Update
			</button>
		</div>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
