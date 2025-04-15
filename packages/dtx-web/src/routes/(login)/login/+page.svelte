<script lang="ts">
	let email = $state('');
	let password = $state('');
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-100">
	<div class="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow-md">
		<h2 class="text-center text-2xl font-bold">Login</h2>
		<form method="POST" action="?/login" class="space-y-6">
			<div>
				<label for="email" class="block text-sm font-medium text-gray-700">Email</label>
				<input
					type="email"
					name="email"
					id="email"
					bind:value={email}
					required
					class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 shadow-xs focus:border-indigo-500 focus:ring-indigo-500 focus:outline-hidden"
				/>
			</div>
			<div>
				<label for="password" class="block text-sm font-medium text-gray-700"
					>Password</label
				>
				<input
					type="password"
					name="password"
					id="password"
					bind:value={password}
					required
					class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 shadow-xs focus:border-indigo-500 focus:ring-indigo-500 focus:outline-hidden"
				/>
			</div>
			<div>
				<button
					type="submit"
					class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-hidden"
				>
					Login
				</button>
			</div>
		</form>
	</div>
</div>
