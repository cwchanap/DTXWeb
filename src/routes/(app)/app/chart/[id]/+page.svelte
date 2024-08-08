<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Database } from '@/types/supabase.types';
	import { goto } from '$app/navigation';

	let simfile: Database['public']['Tables']['simfiles']['Row'] | null = null;
	let loading = true;
	let error: string | null = null;

	onMount(async () => {
		const { id } = $page.params;
		await loadSimfileDetails(id);
	});

	async function loadSimfileDetails(id: string) {
		try {
			const { data, error: fetchError } = await supabase
				.from('simfiles')
				.select('*')
				.eq('id', id)
				.single();

			if (fetchError) throw fetchError;
			simfile = data;
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	function goBack() {
		goto('/app/chart');
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
					<p class="font-semibold">BPM:</p>
					<p>{simfile.bpm}</p>
				</div>
				<div>
					<p class="font-semibold">Artist:</p>
					<p>{simfile.author || 'N/A'}</p>
				</div>
			</div>
		</div>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
