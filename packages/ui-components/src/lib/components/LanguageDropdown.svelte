<script lang="ts">
	export let isOpen = false;
	export let onToggle: ((open: boolean) => void) | undefined = undefined;
	export let onLanguageSelect: ((locale: string) => void) | undefined = undefined;
	export let currentLocale = 'en';
	export let locales = ['en', 'jp'];
	export let localeMap: Record<string, string> = { en: 'English', jp: '日本語' };
	export let buttonClass = 'music-btn-secondary px-4 py-2 text-sm';
	export let dropdownClass = '';
	export let buttonText = 'Change Language';

	function handleToggle() {
		isOpen = !isOpen;
		onToggle?.(isOpen);
	}

	function handleLanguageSelect(locale: string) {
		onLanguageSelect?.(locale);
		isOpen = false;
		onToggle?.(false);
	}

	function handleClickOutside(event: Event) {
		const target = event.target as Element;
		if (!target.closest('.language-dropdown')) {
			isOpen = false;
			onToggle?.(false);
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

<div class="language-dropdown relative">
	<button class={buttonClass} on:click={handleToggle}>
		{buttonText}
	</button>
	{#if isOpen}
		<div
			class="absolute top-full right-0 z-50 mt-2 min-w-[120px] rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl {dropdownClass}"
		>
			{#each locales as locale}
				<button
					class="w-full p-3 text-left text-slate-300 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg hover:bg-purple-600/20 hover:text-purple-200"
					on:click={() => handleLanguageSelect(locale)}
				>
					{localeMap[locale] || locale}
				</button>
			{/each}
		</div>
	{/if}
</div>
