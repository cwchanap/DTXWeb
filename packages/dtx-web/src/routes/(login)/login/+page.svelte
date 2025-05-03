<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let redirectToDesktop = $state(false);

	$effect(() => {
		// Check if we're redirecting from desktop app
		if (browser) {
			redirectToDesktop = $page.url.searchParams.get('redirect') === 'desktop';
		}
	});

	const handleLogin = async () => {
		isLoading = true;
		error = '';

		try {
			// In a real app, we would call the auth API here
			// For this demo, we'll simulate a successful login
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Create a mock token (in a real app, this would come from your auth service)
			// This is a simple JWT structure with a mock payload
			const mockUser = {
				id: 'user123',
				email,
				name: email.split('@')[0]
			};

			// Create a simple token with the user info (not for production use)
			const encodedPayload = btoa(JSON.stringify(mockUser));
			const mockToken = `eyJhbGciOiJIUzI1NiJ9.${encodedPayload}.SIGNATURE`;

			// If we're redirected from desktop, send the token back via protocol
			if (redirectToDesktop && browser) {
				// Use the custom protocol to redirect back to the desktop app
				window.location.href = `dtx://auth-callback?token=${mockToken}`;
			} else {
				// For web app, we would normally set cookies, etc. and redirect
				localStorage.setItem('auth_token', mockToken);
				goto('/');
			}
		} catch (err) {
			console.error('Login failed:', err);
			error = 'Login failed. Please try again.';
		} finally {
			isLoading = false;
		}
	};
</script>

<div class="mt-16 flex justify-center">
	<div class="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
		<h1 class="mb-6 text-center text-2xl font-bold">
			{redirectToDesktop ? 'Login to Desktop App' : 'Login'}
		</h1>

		{#if error}
			<div class="mb-6 border-l-4 border-red-500 bg-red-100 p-4 text-red-700" role="alert">
				<p>{error}</p>
			</div>
		{/if}

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleLogin();
			}}
			class="space-y-4"
		>
			<div>
				<label for="email" class="mb-1 block text-sm font-medium text-gray-700">Email</label
				>
				<input
					type="email"
					id="email"
					bind:value={email}
					required
					class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
				/>
			</div>

			<div>
				<label for="password" class="mb-1 block text-sm font-medium text-gray-700"
					>Password</label
				>
				<input
					type="password"
					id="password"
					bind:value={password}
					required
					class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
				/>
			</div>

			<div>
				<button
					type="submit"
					disabled={isLoading}
					class="w-full rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
				>
					{#if isLoading}
						<span class="flex items-center justify-center">
							<svg
								class="mr-2 -ml-1 h-4 w-4 animate-spin text-white"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								/>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							Processing...
						</span>
					{:else}
						Login
					{/if}
				</button>
			</div>
		</form>

		{#if redirectToDesktop}
			<div class="mt-6 text-center text-sm text-gray-500">
				<p>You'll be redirected back to the desktop app after login.</p>
			</div>
		{/if}
	</div>
</div>
