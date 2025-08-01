<script lang="ts">
	// Desktop Editor component that uses common package components directly
	import { onMount, onDestroy } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { MainTab, SoundTab } from '@dtx/common/components';

	interface Props {
		simfileID?: string;
	}

	let { simfileID }: Props = $props();

	// Editor state
	let currentTab = $state('main');
	let gameContainer: HTMLDivElement;
	let isGameInitialized = $state(false);

	const handleBackToWorkspace = () => {
		// Navigate back to workspace
		window.location.hash = '';
	};

	const switchTab = (tab: string) => {
		currentTab = tab;
	};

	onMount(async () => {
		try {
			// Initialize the Phaser game for the editor
			if (gameContainer) {
				// Import Phaser and required classes
				const Phaser = await import('phaser');
				const { Editor } = await import('@dtx/common/game');
				const { store } = await import('@dtx/common');

				// Set up the game configuration for desktop
				const gameConfig = {
					type: Phaser.AUTO,
					width: gameContainer.clientWidth,
					height: gameContainer.clientHeight,
					parent: gameContainer,
					scene: [Editor],
					backgroundColor: '#1e293b',
					physics: {
						default: 'arcade',
						arcade: {
							gravity: { y: 0, x: 0 },
							debug: false
						}
					}
				};

				// Initialize Phaser game
				const game = new Phaser.Game(gameConfig);

				// If we have a simfileID, load that chart
				if (simfileID) {
					// Load simfile data for editing
					console.log('Loading simfile for editing:', simfileID);
					// TODO: Load simfile data via IPC from main process
					// For now, we'll load it as a new chart
				}

				isGameInitialized = true;

				// Cleanup function
				return () => {
					if (game) {
						game.destroy(true);
					}
				};
			}
		} catch (error) {
			console.error('Failed to initialize desktop editor:', error);
			// Set initialized to true even on error so we don't show loading forever
			isGameInitialized = true;
		}
	});
</script>

<div class="h-screen w-full bg-slate-900 text-white">
	<!-- Header with navigation and tabs -->
	<div
		class="flex items-center justify-between border-b border-slate-700 bg-slate-800 p-4 shadow-sm"
	>
		<div class="flex items-center gap-4">
			<button
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				onclick={handleBackToWorkspace}
				title="Back to Workspace"
			>
				<ArrowLeft size={16} />
				Back to Workspace
			</button>

			<h1 class="text-xl font-semibold">
				DTX Editor {simfileID ? `- Song ID: ${simfileID}` : '- New Chart'}
			</h1>
		</div>

		<!-- Tab Navigation -->
		<div class="flex rounded-lg bg-slate-700 p-1">
			<button
				class="rounded-md px-4 py-2 text-sm font-medium transition-colors {currentTab ===
				'main'
					? 'bg-slate-600 text-white'
					: 'text-slate-300 hover:text-white'}"
				onclick={() => switchTab('main')}
			>
				Main
			</button>
			<button
				class="rounded-md px-4 py-2 text-sm font-medium transition-colors {currentTab ===
				'sound'
					? 'bg-slate-600 text-white'
					: 'text-slate-300 hover:text-white'}"
				onclick={() => switchTab('sound')}
			>
				Sound
			</button>
		</div>
	</div>

	<!-- Editor Content -->
	<div class="flex h-full">
		<!-- Sidebar for tabs -->
		<div class="w-80 border-r border-slate-700 bg-slate-800 p-4">
			{#if currentTab === 'main'}
				<MainTab />
			{:else if currentTab === 'sound'}
				<SoundTab {simfileID} />
			{/if}
		</div>

		<!-- Game Canvas Area -->
		<div class="flex-1 bg-slate-900">
			<div bind:this={gameContainer} class="h-full w-full">
				{#if !isGameInitialized}
					<div class="flex h-full items-center justify-center">
						<div class="text-center">
							<div
								class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<p class="text-slate-400">Initializing editor...</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
