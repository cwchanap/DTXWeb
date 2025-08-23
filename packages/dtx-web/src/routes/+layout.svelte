<script lang="ts">
	import '../app.css';
	import { Toaster } from '@skeletonlabs/skeleton-svelte';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import toastStore from '@/lib/toaster';

	let { data, children } = $props();
	let { session, supabase } = $derived(data);

	onMount(() => {
		// Initialize file provider for dtx-web (client-only)
		(async () => {
			const { setFileProvider } = await import('@dtx/common');
			const { WebFileProvider } = await import('$lib/services/webFileProvider');
			setFileProvider(new WebFileProvider());
		})();

		const { data } = supabase.auth.onAuthStateChange((_, newSession) => {
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => data.subscription.unsubscribe();
	});
</script>

<Toaster toaster={toastStore} />
{@render children?.()}
