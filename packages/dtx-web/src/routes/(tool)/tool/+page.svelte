<script lang="ts">
	import { goto } from '$app/navigation';
	import { locale, locales } from 'svelte-i18n';
	import { _ } from 'svelte-i18n';
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

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto flex items-center justify-between px-4 py-6">
			<h1 class="text-3xl font-bold text-white">Tools</h1>
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
					Change Language
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
			<h2 class="mb-4 text-2xl font-bold">Available Tools</h2>
			<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				{#each tools as tool}
					<div
						class="rounded-lg border border-gray-300 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
					>
						<h3 class="mb-2 text-xl font-semibold">{tool.title}</h3>
						<p class="mb-4 text-gray-600">{tool.description}</p>
						<button
							class="rounded bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700"
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
