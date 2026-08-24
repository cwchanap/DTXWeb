<script lang="ts">
	import '../app.css';
	import { Toaster } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import toastStore from '@/lib/toaster';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	onMount(() => {
		if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
			document.documentElement.dataset.e2eHydrated = 'true';
		}

		// Initialize file provider for dtx-web (client-only)
		(async () => {
			const { setFileProvider } = await import('@dtx/common');
			const { WebFileProvider } = await import('$lib/services/webFileProvider');
			setFileProvider(new WebFileProvider());
		})();
	});
</script>

<Toaster toaster={toastStore} />
{@render children?.()}
