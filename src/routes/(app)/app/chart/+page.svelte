<script lang="ts">
	import ChartList from '@/lib/components/ChartList.svelte';
	import { onMount } from 'svelte';

	let pageSize: number;

	onMount(() => {
		const itemsOnScreen = Math.ceil(window.innerHeight / 200);
		pageSize = itemsOnScreen * 2;
	});
</script>

<div class="container mx-auto p-4">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-2xl font-bold">My Chart</h1>
		<a href="/app/chart/upload" class="rounded bg-blue-600 p-2 text-white hover:bg-blue-500">
			Upload Simfiles
		</a>
	</div>
	<ChartList {pageSize} />
</div>
