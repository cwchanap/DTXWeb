<script lang="ts">
	import { goto } from '$app/navigation';
	import { locale, locales } from 'svelte-i18n';
	import { Popover } from '@skeletonlabs/skeleton-svelte';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};

	let languagePopoverOpen = $state(false);

	const tools = [
		{
			title: 'DTX to MIDI Converter',
			description:
				'Convert DTX drum chart files to MIDI format for use with digital audio workstations',
			href: '/tool/dtx-to-midi'
		},
		{
			title: 'MIDI to DTX Converter',
			description: 'Convert MIDI files to DTX drum chart format for rhythm game use',
			href: '/tool/midi-to-dtx'
		},
		{
			title: 'MIDI Preview',
			description: 'Preview and analyze MIDI files with track information and playback',
			href: '/tool/midi-preview'
		}
	];

	const handleToolClick = (href: string) => {
		goto(href);
	};
</script>

<div class="relative min-h-screen overflow-hidden" style="background: var(--music-bg-primary);">
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

	<header class="music-nav relative z-10">
		<div class="container mx-auto flex items-center justify-between px-6 py-8">
			<div class="flex items-center space-x-4">
				<h1
					class="bg-gradient-to-r from-purple-400 via-cyan-400 to-amber-400 bg-clip-text text-4xl font-bold text-transparent"
				>
					Tools
				</h1>
				<div class="music-bars">
					<div class="music-bar" style="height: 8px;"></div>
					<div class="music-bar" style="height: 16px;"></div>
					<div class="music-bar" style="height: 12px;"></div>
					<div class="music-bar" style="height: 20px;"></div>
					<div class="music-bar" style="height: 6px;"></div>
				</div>
			</div>
			<Popover
				open={languagePopoverOpen}
				onOpenChange={(details) => (languagePopoverOpen = details.open)}
				positioning={{ placement: 'top' }}
				triggerBase="music-btn-secondary px-4 py-2 text-sm"
				contentBase="card bg-surface-200-800 space-y-4 max-w-[320px]"
				arrow
				arrowBackground="!bg-surface-200 dark:!bg-surface-800"
			>
				{#snippet trigger()}
					Change Language
				{/snippet}
				{#snippet content()}
					<div class="rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl">
						{#each $locales as l}
							<button
								class="w-full p-3 text-left text-slate-300 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg hover:bg-purple-600/20 hover:text-purple-200"
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

	<main class="relative z-0 container mx-auto px-6 py-16">
		<section class="mb-12">
			<h2
				class="mb-6 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-3xl font-bold text-transparent"
			>
				Available Tools
			</h2>
			<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				{#each tools as tool}
					<div class="music-card p-6">
						<h3 class="mb-2 text-xl font-semibold text-slate-200">{tool.title}</h3>
						<p class="mb-4 text-slate-300">{tool.description}</p>
						<button
							class="music-btn-primary"
							onclick={() => handleToolClick(tool.href)}
						>
							Open Tool
						</button>
					</div>
				{/each}
			</div>
		</section>
	</main>
</div>
