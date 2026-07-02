<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { AlertCircle, CheckCircle2, Loader } from '@lucide/svelte';
	import {
		GOOGLE_OAUTH_SCOPES,
		buildAccountCallbackUrl,
		sanitizeGoogleAuthError
	} from '$lib/auth/google';

	type LinkedIdentity = {
		provider: string;
		identity_data?: { email?: unknown } | null;
	};

	let { data } = $props();
	let { supabase, user } = $derived(data);

	let identities = $state<LinkedIdentity[]>([]);
	let isLoading = $state(true);
	let isConnecting = $state(false);
	let error = $state('');
	let message = $state('');

	let googleIdentity = $derived(
		identities.find((identity) => identity.provider === 'google') ?? null
	);
	let googleEmail = $derived(
		(typeof googleIdentity?.identity_data?.email === 'string'
			? googleIdentity.identity_data.email
			: null) ?? ''
	);

	const loadIdentities = async () => {
		isLoading = true;
		error = '';
		const { data: identityData, error: identityError } =
			await supabase.auth.getUserIdentities();

		if (identityError) {
			error = 'Unable to load linked account providers.';
			identities = [];
		} else {
			identities = identityData?.identities ?? [];
		}

		isLoading = false;
	};

	const handleConnectGoogle = async () => {
		isConnecting = true;
		error = '';
		message = '';

		const { data: linkData, error: linkError } = await supabase.auth.linkIdentity({
			provider: 'google',
			options: {
				redirectTo: buildAccountCallbackUrl(window.location.origin),
				scopes: GOOGLE_OAUTH_SCOPES,
				skipBrowserRedirect: true
			}
		});

		if (linkError || !linkData?.url) {
			error = sanitizeGoogleAuthError(linkError?.message);
			isConnecting = false;
			return;
		}

		window.location.href = linkData.url;
	};

	onMount(() => {
		if ($page.url.searchParams.get('linked') === 'google') {
			message = 'Google account connected.';
		} else {
			const callbackError = $page.url.searchParams.get('auth_error');
			if (callbackError) {
				error = callbackError;
			}
		}

		loadIdentities();
	});
</script>

<section class="container mx-auto max-w-3xl p-6 text-white">
	<h1 class="mb-6 text-3xl font-bold">Account</h1>

	{#if message}
		<div
			class="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-4 text-emerald-100"
		>
			<div class="flex items-center gap-2">
				<CheckCircle2 size={18} />
				<p>{message}</p>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="mb-4 rounded-lg border border-red-400/30 bg-red-950/30 p-4 text-red-100">
			<div class="flex items-center gap-2">
				<AlertCircle size={18} />
				<p>{error}</p>
			</div>
		</div>
	{/if}

	<div class="rounded-lg border border-purple-500/20 bg-slate-950/60 p-6">
		<div class="mb-6">
			<h2 class="mb-2 text-xl font-semibold">Profile</h2>
			<p class="text-sm text-slate-400">Primary account email</p>
			<p class="mt-1 text-slate-100">{user?.email ?? 'Unknown email'}</p>
		</div>

		<div>
			<h2 class="mb-4 text-xl font-semibold">Connected providers</h2>

			{#if isLoading}
				<div class="flex items-center gap-3 text-slate-300">
					<Loader size={18} class="animate-spin" />
					<span>Loading providers...</span>
				</div>
			{:else}
				<div class="rounded-md border border-slate-700 bg-slate-900/80 p-4">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="font-medium">Google</p>
							{#if googleIdentity}
								<p class="text-sm text-emerald-300">Google is connected</p>
								{#if googleEmail}
									<p class="mt-1 text-sm text-slate-400">{googleEmail}</p>
								{/if}
							{:else}
								<p class="text-sm text-slate-400">Google is not connected</p>
							{/if}
						</div>

						{#if !googleIdentity}
							<button
								type="button"
								onclick={handleConnectGoogle}
								disabled={isConnecting}
								class="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none disabled:opacity-50"
							>
								{isConnecting ? 'Connecting...' : 'Connect Google'}
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</section>
