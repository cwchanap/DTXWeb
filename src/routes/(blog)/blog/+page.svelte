<script lang="ts">
	import ChartList from '@/lib/components/ChartList.svelte';
</script>

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto px-4 py-6">
			<h1 class="text-3xl font-bold text-white">Welcome to Hapadona's DTX Blog</h1>
		</div>
	</header>

	<main class="container mx-auto px-4 py-8">
		<section class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Latest News</h2>
			<p class="text-gray-700">No news yet.</p>
		</section>
		<section class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Latest Simfiles</h2>
			<ChartList isBlog={true}/>
		</section>
	</main>
</div>
