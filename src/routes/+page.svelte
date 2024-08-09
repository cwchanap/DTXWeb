<script>
	import { goto } from '$app/navigation';

	const navigateToLogin = () => {
		goto('/login');
	};

	const handleSecondButtonClick = () => {
		// Add your custom action here, for example, navigate to a new page
		goto('/game');
	};

	const navigateToBlog = () => {
		goto('/blog');
	};
</script>

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto px-4 py-6">
			<h1 class="text-3xl font-bold text-white">Welcome!!</h1>
		</div>
	</header>

	<main class="container mx-auto px-4 py-8">
		<section class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Introduction</h2>
			<p class="text-gray-700">
				Welcome to hapadona's site! Here you can find various resources and information
				about what we offer. Stay tuned for more updates and features!
			</p>
		</section>
		<section class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Links</h2>
			<div class="flex flex-col items-center space-y-4">
				<button
					on:click={navigateToBlog}
					class="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
				>
					Go to simfile repo
				</button>
				{#if false}
					<button
						on:click={navigateToLogin}
						class="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
					>
						Login
					</button>
					<button
						on:click={handleSecondButtonClick}
						class="rounded-lg bg-gray-600 px-4 py-2 text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
					>
						Game
					</button>
				{/if}
			</div>
		</section>
	</main>
</div>
