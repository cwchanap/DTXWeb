<script lang="ts">
	import { tick } from 'svelte';
	import type { Action } from 'svelte/action';

	export let isOpen = false;
	export let onToggle: ((open: boolean) => void) | undefined = undefined;
	export let onLanguageSelect: ((locale: string) => void) | undefined = undefined;
	export const currentLocale = 'en';
	export let locales = ['en', 'jp'];
	export let localeMap: Record<string, string> = { en: 'English', jp: '日本語' };
	export let buttonClass = 'music-btn-secondary px-4 py-2 text-sm';
	export let dropdownClass = '';
	export let buttonText = 'Change Language';

	let triggerButton: HTMLButtonElement | null = null;
	const menuItemRefs = new Map<string, HTMLButtonElement>();

	// Refs are stored by locale (the each-block key) rather than by mount-time
	// index so keyboard navigation can derive the current visual order from
	// `locales` — keyed reordering moves nodes without re-running the action.
	const orderedMenuItems = (): HTMLButtonElement[] =>
		locales
			.map((locale) => menuItemRefs.get(locale))
			.filter((ref): ref is HTMLButtonElement => ref !== undefined);

	const setMenuItemRef: Action<HTMLButtonElement, string> = (node, locale) => {
		menuItemRefs.set(locale, node);
		return {
			destroy() {
				menuItemRefs.delete(locale);
			}
		};
	};

	async function openMenu() {
		if (isOpen) return;
		isOpen = true;
		onToggle?.(true);
		await tick();
		orderedMenuItems()[0]?.focus();
	}

	function closeMenu(focusTrigger = false) {
		if (!isOpen) return;
		isOpen = false;
		onToggle?.(false);
		if (focusTrigger) {
			triggerButton?.focus();
		}
	}

	async function handleToggle() {
		if (isOpen) {
			closeMenu(true);
		} else {
			await openMenu();
		}
	}

	function handleLanguageSelect(locale: string) {
		onLanguageSelect?.(locale);
		closeMenu(true);
	}

	function handleClickOutside(event: Event) {
		const target = event.target as Element;
		if (!target.closest('.language-dropdown')) {
			closeMenu();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!isOpen) return;

		const items = orderedMenuItems();
		const activeElement = document.activeElement as HTMLElement | null;
		const menuHasFocus = items.some((ref) => ref === activeElement);

		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				closeMenu(true);
				return;
			case 'ArrowDown':
			case 'ArrowUp': {
				event.preventDefault();
				if (items.length === 0) return;

				let nextIndex = items.findIndex((ref) => ref === activeElement);

				if (nextIndex === -1) {
					nextIndex = event.key === 'ArrowDown' ? 0 : items.length - 1;
				} else {
					nextIndex =
						event.key === 'ArrowDown'
							? (nextIndex + 1) % items.length
							: (nextIndex - 1 + items.length) % items.length;
				}

				items[nextIndex]?.focus();
				return;
			}
			case 'Home':
			case 'End': {
				if (!menuHasFocus) return;
				event.preventDefault();
				const targetIndex = event.key === 'Home' ? 0 : items.length - 1;
				items[targetIndex]?.focus();
				return;
			}
			case 'Tab':
				closeMenu();
				return;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleWindowKeydown} />

<div class="language-dropdown relative">
	<button
		type="button"
		class={buttonClass}
		on:click={handleToggle}
		aria-haspopup="true"
		aria-expanded={isOpen}
		bind:this={triggerButton}
	>
		{buttonText}
	</button>
	{#if isOpen}
		<div
			class="absolute top-full right-0 z-50 mt-2 min-w-[120px] rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl {dropdownClass}"
			role="menu"
			aria-label="Language selection"
		>
			{#each locales as locale (locale)}
				<button
					class="w-full p-3 text-left text-slate-300 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg hover:bg-purple-600/20 hover:text-purple-200"
					on:click={() => handleLanguageSelect(locale)}
					role="menuitem"
					tabindex="-1"
					use:setMenuItemRef={locale}
				>
					{localeMap[locale] || locale}
				</button>
			{/each}
		</div>
	{/if}
</div>
