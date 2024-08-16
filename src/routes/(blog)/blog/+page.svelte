<script lang="ts">
	import ChartList from '@/lib/components/ChartList.svelte';
	import { locale, locales } from 'svelte-i18n';
	import { _ } from 'svelte-i18n';
	import { popup } from '@skeletonlabs/skeleton';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};
</script>

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto flex items-center justify-between px-4 py-6">
			<h1 class="text-3xl font-bold text-white">{$_('blog.welcome_message')}</h1>
			<button
				use:popup={{
					event: 'click',
					target: 'language-selector',
					placement: 'bottom'
				}}
				class="rounded bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-700"
			>
				{$_('blog.change_language')}
			</button>
		</div>
	</header>

	<div data-popup="language-selector">
		<div class="btn-group-vertical mt-1 rounded border border-gray-300 bg-white shadow-lg">
			{#each $locales as l}
				<button class="hover:bg-gray-100" on:click={() => locale.set(l)}
					>{localeMap[l]}</button
				>
			{/each}
		</div>
	</div>

	<main class="container mx-auto px-4 py-8">
		<section class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">{$_('blog.latest_news')}</h2>
			<p class="text-gray-700">{$_('blog.no_news_yet')}</p>
		</section>
		<section class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">{$_('blog.latest_simfiles')}</h2>
			<ChartList isBlog={true} />
		</section>
	</main>
</div>
