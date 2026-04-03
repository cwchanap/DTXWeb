<script lang="ts">
	import ChartList from '$lib/components/ChartList.svelte';
	import { env } from '$env/dynamic/public';
	import { locale, locales } from 'svelte-i18n';
	import { _ } from 'svelte-i18n';

	const enableBlogDownload = env.PUBLIC_ENABLE_BLOG_DOWNLOAD === 'true';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};

	let languageDropdownOpen = $state(false);

	const handleClickOutside = (event: Event) => {
		const target = event.target as Element;
		if (!target.closest('.language-dropdown')) {
			languageDropdownOpen = false;
		}
	};
</script>

<svelte:window on:click={handleClickOutside} />

<div class="relative min-h-screen overflow-hidden">
	<!-- Animated background elements -->
	<div class="absolute inset-0 opacity-20">
		<div
			class="absolute top-20 left-10 h-32 w-32 animate-pulse rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl"
		></div>
		<div
			class="absolute top-40 right-20 h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 blur-lg"
			style="animation-delay: 1s;"
		></div>
		<div
			class="absolute bottom-20 left-1/3 h-40 w-40 animate-pulse rounded-full bg-gradient-to-br from-amber-500 to-orange-500 blur-2xl"
			style="animation-delay: 2s;"
		></div>
	</div>

	<header class="music-nav pointer-events-none relative z-10">
		<div
			class="pointer-events-none container mx-auto flex items-center justify-between px-6 py-8"
		>
			<div class="pointer-events-auto relative z-0 flex items-center space-x-4">
				<h1
					class="bg-gradient-to-r from-purple-400 via-cyan-400 to-amber-400 bg-clip-text text-4xl font-bold text-transparent"
				>
					{$_('blog.welcome_message')}
				</h1>
				<div class="music-bars">
					<div class="music-bar" style="height: 8px;"></div>
					<div class="music-bar" style="height: 16px;"></div>
					<div class="music-bar" style="height: 12px;"></div>
					<div class="music-bar" style="height: 20px;"></div>
					<div class="music-bar" style="height: 6px;"></div>
				</div>
			</div>
			<div class="language-dropdown pointer-events-auto relative">
				<button
					class="music-btn-secondary px-4 py-2 text-sm"
					onclick={() => (languageDropdownOpen = !languageDropdownOpen)}
				>
					{$_('blog.change_language')}
				</button>
				{#if languageDropdownOpen}
					<div
						class="absolute top-full right-0 z-[100] mt-2 min-w-[120px] rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl"
					>
						{#each $locales as l}
							<button
								class="w-full p-3 text-left text-slate-300 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg hover:bg-purple-600/20 hover:text-purple-200"
								onclick={() => {
									locale.set(l);
									languageDropdownOpen = false;
								}}
							>
								{localeMap[l]}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main class="relative z-0 container mx-auto px-6 py-16">
		<section class="mb-12">
			<h2
				class="mb-6 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-3xl font-bold text-transparent"
			>
				{$_('blog.latest_news')}
			</h2>
			<div class="music-card p-6">
				<p class="text-slate-300">{$_('blog.no_news_yet')}</p>
			</div>
		</section>
		<section class="mb-12">
			<h2
				class="mb-6 bg-gradient-to-r from-cyan-400 to-amber-400 bg-clip-text text-3xl font-bold text-transparent"
			>
				{$_('blog.latest_simfiles')}
			</h2>
			<ChartList isBlog={true} enableDownload={enableBlogDownload} />
		</section>
	</main>
</div>
