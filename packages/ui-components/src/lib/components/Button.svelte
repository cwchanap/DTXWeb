<script lang="ts">
	import { clsx } from 'clsx';

	type Variant =
		| 'default'
		| 'primary'
		| 'secondary'
		| 'outline'
		| 'ghost'
		| 'danger'
		| 'menuItem'
		| 'floating';
	type Size = 'sm' | 'md' | 'lg' | 'icon';
	type Justify = 'start' | 'center' | 'end';
	type Padding = 'none' | '1' | '2' | '3' | '4' | '6' | '8';
	type Position = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';

	let {
		variant = 'default',
		size = 'md',
		disabled = false,
		type = 'button',
		class: className = '',
		ariaLabel,
		fullWidth = false,
		justify = 'center',
		padding,
		position,
		centered = false,
		children,
		iconRight
	} = $props<{
		variant?: Variant;
		size?: Size;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		class?: string;
		ariaLabel?: string;
		fullWidth?: boolean;
		justify?: Justify;
		padding?: Padding;
		position?: Position;
		centered?: boolean;
		children?: import('svelte').Snippet;
		iconRight?: import('svelte').Snippet;
	}>();

	const base =
		'inline-flex items-center rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

	function variantClasses(v: Variant) {
		switch (v) {
			case 'primary':
				return 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500';
			case 'secondary':
				return 'bg-gray-800 text-white hover:bg-gray-900 focus:ring-gray-600';
			case 'outline':
				return 'border border-gray-300 hover:bg-gray-50';
			case 'ghost':
				return 'hover:bg-gray-100';
			case 'danger':
				return 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500';
			case 'menuItem':
				return 'hover:bg-gray-100 text-gray-700 text-sm rounded-none px-4 py-2';
			case 'floating':
				return 'bg-white shadow-lg hover:shadow-xl rounded-full';
			default:
				return 'bg-gray-200 text-gray-900 hover:bg-gray-300';
		}
	}

	function sizeClasses(s: Size) {
		switch (s) {
			case 'sm':
				return 'h-8 px-2 text-sm';
			case 'lg':
				return 'h-12 px-6';
			case 'icon':
				return 'h-9 w-9';
			default:
				return 'h-10 px-4';
		}
	}

	function justifyClasses(j: Justify) {
		switch (j) {
			case 'start':
				return 'justify-start';
			case 'end':
				return 'justify-end';
			default:
				return 'justify-center';
		}
	}

	function getWidthClasses() {
		return fullWidth ? 'w-full' : '';
	}

	function getPaddingClasses() {
		if (!padding) return '';
		switch (padding) {
			case 'none':
				return 'p-0';
			case '1':
				return 'p-1';
			case '2':
				return 'p-2';
			case '3':
				return 'p-3';
			case '4':
				return 'p-4';
			case '6':
				return 'p-6';
			case '8':
				return 'p-8';
			default:
				return '';
		}
	}

	function getPositionClasses() {
		const classes = [];
		if (position) {
			classes.push(position);
		}
		if (centered) {
			classes.push('top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform');
		}
		return classes.join(' ');
	}
</script>

<button
	{type}
	class={clsx(
		base,
		variantClasses(variant),
		sizeClasses(size),
		justifyClasses(justify),
		getWidthClasses(),
		getPaddingClasses(),
		getPositionClasses(),
		className
	)}
	{disabled}
	aria-label={ariaLabel}
>
	{@render children?.()}
	{#if iconRight}
		<span class="ml-2">{@render iconRight()}</span>
	{/if}
</button>

<style>
	/* relies on consumer Tailwind setup */
</style>
