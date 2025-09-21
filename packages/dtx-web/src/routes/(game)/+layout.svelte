<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>Drumery - Game</title>
</svelte:head>

<div id="app" class="relative min-h-screen overflow-hidden">
	<!-- Animated background for game mode -->
	<div class="absolute inset-0 opacity-30">
		<div
			class="absolute top-10 left-10 h-20 w-20 animate-pulse rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl"
		></div>
		<div
			class="absolute top-20 right-20 h-16 w-16 animate-pulse rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 blur-lg"
			style="animation-delay: 1s;"
		></div>
		<div
			class="absolute bottom-20 left-1/4 h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-amber-500 to-orange-500 blur-2xl"
			style="animation-delay: 2s;"
		></div>
		<div
			class="absolute right-1/3 bottom-10 h-18 w-18 animate-pulse rounded-full bg-gradient-to-br from-pink-500 to-red-500 blur-lg"
			style="animation-delay: 3s;"
		></div>
	</div>

	<!-- Game content area with enhanced styling -->
	<div class="relative z-10 px-8 py-6">
		{@render children?.()}
	</div>

	<!-- Music visualizer overlay for ambiance -->
	<div class="pointer-events-none absolute bottom-4 left-4 opacity-20">
		<div class="music-bars scale-75">
			<div class="music-bar" style="height: 8px;"></div>
			<div class="music-bar" style="height: 16px;"></div>
			<div class="music-bar" style="height: 12px;"></div>
			<div class="music-bar" style="height: 20px;"></div>
			<div class="music-bar" style="height: 6px;"></div>
			<div class="music-bar" style="height: 14px;"></div>
			<div class="music-bar" style="height: 10px;"></div>
		</div>
	</div>
</div>

<style>
	#app {
		width: 100%;
		height: 100vh;
		background: linear-gradient(135deg, #0f0f23 0%, #1e1b4b 30%, #312e81 70%, #1e1b4b 100%);
		position: relative;
	}

	/* Add subtle beat pulse effect to the entire game area */
	#app::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: radial-gradient(
			ellipse at center,
			rgba(139, 92, 246, 0.05) 0%,
			transparent 70%
		);
		animation: beat-pulse 2s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes beat-pulse {
		0%,
		100% {
			opacity: 0.05;
		}
		50% {
			opacity: 0.1;
		}
	}
</style>
