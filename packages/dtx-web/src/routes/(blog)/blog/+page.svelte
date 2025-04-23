<script lang="ts">
	import ChartList from '$lib/components/ChartList.svelte';
	import { locale, locales } from 'svelte-i18n';
	import { _ } from 'svelte-i18n';
	import { Popover } from '@skeletonlabs/skeleton-svelte';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};

	let languagePopoverOpen = $state(false);
</script>

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto flex items-center justify-between px-4 py-6">
			<h1 class="text-3xl font-bold text-white">{$_('blog.welcome_message')}</h1>
			<Popover
				open={languagePopoverOpen}
				onOpenChange={(details) => (languagePopoverOpen = details.open)}
				positioning={{ placement: 'top' }}
				triggerBase="rounded-sm bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-700"
				contentBase="card bg-surface-200-800 space-y-4 max-w-[320px]"
				arrow
				arrowBackground="!bg-surface-200 dark:!bg-surface-800"
			>
				{#snippet trigger()}
					{$_('blog.change_language')}
				{/snippet}
				{#snippet content()}
					<div class="mt-1 rounded-sm border border-gray-300 bg-white shadow-lg">
						{#each $locales as l}
							<button
								class="w-full p-2 text-left hover:bg-gray-100"
								onclick={() => locale.set(l)}
							>
								{localeMap[l]}
							</button>
						{/each}
					</div>
				{/snippet}
			</Popover>
		</div>
	</header>

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
