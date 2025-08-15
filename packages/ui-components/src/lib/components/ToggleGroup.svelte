<script lang="ts">
	import { clsx } from 'clsx';

	type Size = 'sm' | 'md' | 'lg';
	type Variant = 'default' | 'outline';

	interface ToggleOption<T> {
		value: T;
		label: string;
		disabled?: boolean;
	}

	let {
		options = [],
		value = $bindable(),
		size = 'md',
		variant = 'default',
		disabled = false,
		class: className = '',
		ariaLabel
	} = $props<{
		options: ToggleOption<any>[];
		value?: any;
		size?: Size;
		variant?: Variant;
		disabled?: boolean;
		class?: string;
		ariaLabel?: string;
	}>();

	const base =
		'inline-flex items-center justify-center rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

	function getVariantClasses(isSelected: boolean, v: Variant) {
		if (v === 'outline') {
			return isSelected
				? 'bg-blue-600 text-white border border-blue-600 hover:bg-blue-700'
				: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50';
		}
		// default variant
		return isSelected
			? 'bg-blue-600 text-white hover:bg-blue-700'
			: 'bg-gray-200 text-gray-700 hover:bg-gray-300';
	}

	function getSizeClasses(s: Size) {
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

	function handleSelect(optionValue: any) {
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
