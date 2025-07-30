<script lang="ts">
	// Desktop Editor component that embeds the web editor in an iframe
	// This avoids import conflicts and reuses the full web editor functionality
	import { onMount } from 'svelte';
	import { ArrowLeft, AlertCircle } from '@lucide/svelte';

	interface Props {
		simfileID?: string;
	}

	let { simfileID }: Props = $props();
	let editorContainer: HTMLDivElement;
	let isLoading = $state(true);
	let hasError = $state(false);
	let errorMessage = $state('');

	const handleBackToWorkspace = () => {
		// Navigate back to workspace
		window.location.hash = '';
	};

	onMount(() => {
		// For the desktop version, we'll embed the web editor in an iframe
		// This allows us to reuse all the existing editor functionality without import conflicts
		const iframe = document.createElement('iframe');

		// Use the web editor URL - for now we'll use the local development server
		// In a production environment, this could be configured to use a deployed web app
		const baseUrl = 'http://localhost:5174'; // Assume web app runs on different port
		const editorUrl = simfileID ? `${baseUrl}/editor/${simfileID}` : `${baseUrl}/editor`;

		iframe.src = editorUrl;
		iframe.style.width = '100%';
		iframe.style.height = 'calc(100vh - 60px)'; // Account for header height
		iframe.style.border = 'none';
		iframe.style.borderRadius = '8px';
		iframe.style.backgroundColor = '#f8fafc'; // Light background while loading

		// Handle loading states
		iframe.onload = () => {
			console.log('Editor loaded successfully');
			isLoading = false;
			hasError = false;
		};

		iframe.onerror = (error) => {
			console.error('Error loading editor:', error);
			isLoading = false;
			hasError = true;
			errorMessage =
				'Failed to load the editor. Make sure the web application is running on port 5174.';
		};

		// Timeout fallback to show error if loading takes too long
		setTimeout(() => {
			if (isLoading) {
				isLoading = false;
				hasError = true;
				errorMessage =
					'Editor loading timed out. Please check your internet connection or try again later.';
			}
		}, 15000); // 15 second timeout

		if (editorContainer) {
			editorContainer.appendChild(iframe);
		}

		// Cleanup
		return () => {
			if (editorContainer && iframe && editorContainer.contains(iframe)) {
				editorContainer.removeChild(iframe);
			}
		};
	});
</script>

<div class="h-screen w-full bg-white dark:bg-slate-900">
	<!-- Header with back button -->
	<div
		class="flex items-center justify-between border-b border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
	>
		<h1 class="text-xl font-semibold text-slate-800 dark:text-slate-100">
			DTX Editor {simfileID ? `- Song ID: ${simfileID}` : '- New Chart'}
		</h1>
		<button
			class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
			onclick={handleBackToWorkspace}
			title="Back to Workspace"
		>
			<ArrowLeft size={16} />
			Back to Workspace
		</button>
	</div>

	<!-- Editor container with loading and error states -->
	<div class="relative h-full w-full">
		<div bind:this={editorContainer} class="h-full w-full"></div>

		<!-- Loading overlay -->
		{#if isLoading}
			<div
				class="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900"
			>
				<div class="text-center">
					<div
						class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"
					></div>
					<p class="text-sm text-slate-600 dark:text-slate-400">Loading Editor...</p>
					<p class="mt-2 text-xs text-slate-500 dark:text-slate-500">
						This may take a moment while the web editor loads
					</p>
				</div>
			</div>
		{/if}

		<!-- Error overlay -->
		{#if hasError}
			<div
				class="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900"
			>
				<div class="mx-auto max-w-md text-center">
					<AlertCircle class="mx-auto mb-4 h-12 w-12 text-red-500" />
					<h3 class="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-200">
						Editor Not Available
					</h3>
					<p class="mb-4 text-sm text-slate-600 dark:text-slate-400">
						{errorMessage}
					</p>
					<div class="space-y-2">
						<button
							class="w-full rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
							onclick={() => window.location.reload()}
						>
							Try Again
						</button>
						<button
							class="w-full rounded-lg border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:outline-none dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
							onclick={handleBackToWorkspace}
						>
							Back to Workspace
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
