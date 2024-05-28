<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '../supabase';

	let isAuthenticated = false;

	onMount(async () => {
		const { data, error } = await supabase.auth.getSession()
        isAuthenticated = !!data.session && !error;
		if (!isAuthenticated) {
			goto('/login');
		}
	});
</script>

{#if isAuthenticated === false}
	<div class="flex h-screen items-center justify-center">
		<div class="text-2xl font-bold">Loading...</div>
	</div>
{:else}
	<slot />
{/if}
