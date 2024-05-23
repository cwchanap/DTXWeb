<script>
	export let pageTitle = 'Dashboard';

	let isSidebarCollapsed = false;

	const toggleSidebar = () => {
		isSidebarCollapsed = !isSidebarCollapsed;
	};

	const logout = () => {
		console.log('Logout clicked');
		// Handle logout logic here
	};

	const navigateToProfile = () => {
		console.log('Profile clicked');
		// Navigate to profile page
	};
</script>

<div class="flex min-h-screen">
	<!-- Sidebar -->
	<aside
		class={`bg-gray-800 text-white ${isSidebarCollapsed ? 'collapsed-sidebar' : 'expanded-sidebar'}`}
	>
		<div class="p-4">
			<button on:click={toggleSidebar} class="text-white focus:outline-none">
				{#if isSidebarCollapsed}
					&#x25B6; <!-- Right arrow -->
				{:else}
					&#x25C0; <!-- Left arrow -->
				{/if}
			</button>
		</div>
		<nav class="mt-4 space-y-4">
			<a href="/app/chart" class="block px-4 py-2 hover:bg-gray-700">Chart</a>
			<a href="/app/score" class="block px-4 py-2 hover:bg-gray-700">Score</a>
		</nav>
	</aside>

	<!-- Main Content -->
	<div class="flex-1">
		<!-- Top Navigation Bar -->
		<header class="bg-indigo-600 text-white">
			<div class="container mx-auto flex items-center justify-between px-4 py-4">
				<h1 class="flex-grow text-xl font-bold">My App</h1>
				<nav class="flex space-x-4">
					<button on:click={navigateToProfile} class="hover:underline">Profile</button>
					<button on:click={logout} class="hover:underline">Logout</button>
				</nav>
			</div>
		</header>

		<!-- Main Page Content -->
		<main class="p-8">
			<h2 class="mb-4 text-2xl font-bold">{pageTitle}</h2>
			<slot />
		</main>
	</div>
</div>

<style>
	.collapsed-sidebar {
		width: 4rem;
	}
	.expanded-sidebar {
		width: 16rem;
	}
</style>
