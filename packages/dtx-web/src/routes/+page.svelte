<script>
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const navigateToBlog = () => {
		goto('/blog');
	};

	const navigateToTools = () => {
		goto('/tool');
	};

	const navigateToEditor = () => {
		goto('/editor');
	};

	let heroAnimated = false;

	onMount(() => {
		setTimeout(() => {
			heroAnimated = true;
		}, 100);
	});
</script>

<div class="relative min-h-screen overflow-hidden" style="background: var(--music-bg-primary);">
	<!-- Animated background elements -->
	<div class="absolute inset-0 opacity-20">
		<div
			class="absolute top-20 left-10 h-32 w-32 animate-pulse rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl"
		></div>
		<div
			class="absolute top-40 right-20 h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 blur-lg"
			style="animation-delay: 1s;"
		></div>
		<div
			class="absolute bottom-20 left-1/3 h-40 w-40 animate-pulse rounded-full bg-gradient-to-br from-amber-500 to-orange-500 blur-2xl"
			style="animation-delay: 2s;"
		></div>
	</div>

	<!-- Header with music visualizer -->
	<header class="music-nav relative z-10">
		<div class="container mx-auto px-6 py-8">
			<div class="flex items-center justify-between">
				<div class="flex items-center space-x-4">
					<h1
						class="bg-gradient-to-r from-purple-400 via-cyan-400 to-amber-400 bg-clip-text text-4xl font-bold text-transparent"
					>
						Drumery
					</h1>
					<div class="music-bars">
						<div class="music-bar" style="height: 8px;"></div>
						<div class="music-bar" style="height: 16px;"></div>
						<div class="music-bar" style="height: 12px;"></div>
						<div class="music-bar" style="height: 20px;"></div>
						<div class="music-bar" style="height: 6px;"></div>
					</div>
				</div>
				<nav class="hidden space-x-6 md:flex">
					<a href="/blog" class="text-slate-300 transition-colors hover:text-purple-400"
						>Charts</a
					>
					<a href="/editor" class="text-slate-300 transition-colors hover:text-green-400"
						>Editor</a
					>
					<a href="/tool" class="text-slate-300 transition-colors hover:text-cyan-400"
						>Tools</a
					>
				</nav>
			</div>
		</div>
	</header>

	<!-- Hero Section -->
	<main class="relative z-10 container mx-auto px-6 py-16">
		<section class="mb-20 text-center">
			<div
				class="transform transition-all duration-1000 {heroAnimated
					? 'translate-y-0 opacity-100'
					: 'translate-y-8 opacity-0'}"
			>
				<h2 class="mb-6 text-6xl leading-tight font-bold md:text-7xl">
					<span
						class="bg-gradient-to-r from-purple-400 via-cyan-400 to-amber-400 bg-clip-text text-transparent"
					>
						Feel the Beat
					</span>
				</h2>
				<p class="mx-auto mb-8 max-w-4xl text-xl text-slate-300 md:text-2xl">
					Experience the ultimate rhythm gaming platform for DTX drum simulation files.
					Create, play, and share your musical journey with our advanced drum charts.
				</p>

				<!-- Feature highlights -->
				<div class="mt-16 mb-16 grid grid-cols-1 gap-8 md:grid-cols-3">
					<div class="music-card group p-8 text-center">
						<div class="mb-4 text-4xl group-hover:animate-pulse">🎵</div>
						<h3 class="mb-3 text-xl font-semibold text-purple-300">Create & Edit</h3>
						<p class="text-slate-400">
							Advanced DTX editor with real-time preview and comprehensive tools
						</p>
					</div>
					<div class="music-card group p-8 text-center">
						<div class="mb-4 text-4xl group-hover:animate-pulse">🥁</div>
						<h3 class="mb-3 text-xl font-semibold text-cyan-300">Play & Challenge</h3>
						<p class="text-slate-400">
							Immersive gameplay with precise timing and visual effects
						</p>
					</div>
					<div class="music-card group p-8 text-center">
						<div class="mb-4 text-4xl group-hover:animate-pulse">🎶</div>
						<h3 class="mb-3 text-xl font-semibold text-amber-300">Share & Discover</h3>
						<p class="text-slate-400">
							Community-driven chart sharing and discovery platform
						</p>
					</div>
				</div>

				<!-- Action buttons -->
				<div class="flex flex-col items-center justify-center gap-6 sm:flex-row">
					<button on:click={navigateToBlog} class="music-btn-primary px-8 py-4 text-lg">
						🎵 Explore Charts
					</button>
					<button
						on:click={navigateToEditor}
						class="music-btn-secondary px-8 py-4 text-lg"
					>
						✏️ Chart Editor
					</button>
					<button
						on:click={navigateToTools}
						class="music-btn-secondary px-8 py-4 text-lg"
					>
						🛠️ DTX Tools
					</button>
				</div>
			</div>
		</section>

		<!-- Stats section -->
		<section class="mt-20 grid grid-cols-2 gap-8 md:grid-cols-4">
			<div class="text-center">
				<div class="mb-2 text-3xl font-bold text-purple-400">1000+</div>
				<div class="text-slate-400">Charts Available</div>
			</div>
			<div class="text-center">
				<div class="mb-2 text-3xl font-bold text-cyan-400">50+</div>
				<div class="text-slate-400">Active Users</div>
			</div>
			<div class="text-center">
				<div class="mb-2 text-3xl font-bold text-amber-400">24/7</div>
				<div class="text-slate-400">Online Access</div>
			</div>
			<div class="text-center">
				<div class="mb-2 text-3xl font-bold text-pink-400">∞</div>
				<div class="text-slate-400">Possibilities</div>
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer class="mt-20 border-t border-purple-500/20 py-8">
		<div class="container mx-auto px-6 text-center text-slate-400">
			<p>&copy; 2024 Drumery. Feel the rhythm, master the beat.</p>
		</div>
	</footer>
</div>
