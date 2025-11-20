<script lang="ts">
	import { clsx } from 'clsx';

	type Size = 'sm' | 'md' | 'lg';
	type Variant = 'default' | 'outline';
	type ToggleValue = string | number | boolean;

	interface ToggleOption<T> {
		value: T;
		label: string;
		disabled?: boolean;
	}

	interface Props<T> {
		options: ToggleOption<T>[];
		value?: T;
		size?: Size;
		variant?: Variant;
		disabled?: boolean;
		class?: string;
		ariaLabel?: string;
	}

	let {
		options = [],
		value = $bindable(),
		size = 'md' as Size,
		variant = 'default' as Variant,
		disabled = false,
		class: className = '',
		ariaLabel
	}: Props<ToggleValue> = $props();

	const base =
		'inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:pointer-events-none';

	function getVariantClasses(isSelected: boolean, v: string) {
		if (v === 'outline') {
			return isSelected
				? 'bg-purple-600 text-white border border-purple-600 hover:bg-purple-700'
				: 'bg-slate-800/50 text-slate-300 border border-purple-500/30 hover:bg-slate-700/50 hover:text-slate-200';
		}
		// default variant
		return isSelected
			? 'bg-purple-600 text-white hover:bg-purple-700'
			: 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50';
	}

	function getSizeClasses(s: string) {
		switch (s) {
			case 'sm':
				return 'px-2 py-1 text-xs';
			case 'lg':
				return 'px-4 py-3 text-base';
			default:
				return 'px-3 py-2 text-sm';
		}
	}

	function getGroupClasses() {
		return 'inline-flex rounded-md shadow-sm';
	}

	function getButtonClasses(index: number, isSelected: boolean) {
		const isFirst = index === 0;
		const isLast = index === options.length - 1;

		let roundedClasses = '';
		if (isFirst && isLast) {
			roundedClasses = 'rounded-md';
		} else if (isFirst) {
			roundedClasses = 'rounded-l-md';
		} else if (isLast) {
			roundedClasses = 'rounded-r-md';
		}

		const borderClasses =
			variant === 'outline'
				? isFirst
					? ''
					: '-ml-px' // Overlap borders for outline variant
				: '';

		return clsx(
			base,
			getVariantClasses(isSelected, variant),
			getSizeClasses(size),
			roundedClasses,
			borderClasses,
			'focus:z-10' // Ensure focused button appears above others
		);
	}

	function handleSelect(optionValue: ToggleValue) {
		if (!disabled) {
			value = optionValue;
		}
	}
</script>

<div class={clsx(getGroupClasses(), className)} role="group" aria-label={ariaLabel}>
	{#each options as option, index}
		{@const isSelected = value === option.value}
		{@const isDisabled = disabled || option.disabled}
		<button
			type="button"
			class={getButtonClasses(index, isSelected)}
			disabled={isDisabled}
			onclick={() => handleSelect(option.value)}
			aria-pressed={isSelected}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	/* relies on consumer Tailwind setup */
</style>
