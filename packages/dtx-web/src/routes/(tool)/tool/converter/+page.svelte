<script lang="ts">
	import { goto } from '$app/navigation';
	import { locale, locales } from 'svelte-i18n';
	import { Popover } from '@skeletonlabs/skeleton-svelte';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};

	let languagePopoverOpen = $state(false);
	let uploadedFile = $state<File | null>(null);
	let isConverting = $state(false);
	let isConverted = $state(false);
	let convertedFileName = $state<string>('');

	let fileInput: HTMLInputElement;

	const handleFileUpload = (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (file && file.type === 'audio/midi') {
			uploadedFile = file;
			isConverted = false;
		} else if (file) {
			alert('Please select a valid MIDI file (.mid or .midi)');
			target.value = '';
		}
	};

	const handleUploadClick = () => {
		fileInput?.click();
	};

	const handleConvert = async () => {
		if (!uploadedFile) return;

		isConverting = true;

		// Simulate conversion process
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const baseName = uploadedFile.name.replace(/\.[^/.]+$/, '');
		convertedFileName = `${baseName}.dtx`;
		isConverting = false;
		isConverted = true;
	};

	const handleDownload = () => {
		// For now, create a placeholder DTX file
		const dtxContent = `#TITLE:${convertedFileName.replace('.dtx', '')}
#ARTIST:Unknown
#BPM:120
#WAV01:kick.wav
#WAV02:snare.wav

#PREVIEW:preview.wav
#PREIMAGE:cover.jpg

11: 01020000 01020000 01020000 01020000`;

		const blob = new Blob([dtxContent], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = convertedFileName;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleReset = () => {
		uploadedFile = null;
		isConverted = false;
		isConverting = false;
		convertedFileName = '';
		if (fileInput) {
			fileInput.value = '';
		}
	};

	const handleBack = () => {
		goto('/tool');
	};
</script>

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto flex items-center justify-between px-4 py-6">
			<div class="flex items-center gap-4">
				<button
					class="text-white transition-colors hover:text-gray-200"
					onclick={handleBack}
				>
					← Back to Tools
				</button>
				<h1 class="text-3xl font-bold text-white">MIDI to DTX Converter</h1>
			</div>
			<Popover
				open={languagePopoverOpen}
				onOpenChange={(details) => (languagePopoverOpen = details.open)}
				positioning={{ placement: 'top' }}
				triggerBase="rounded-sm bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-700"
				contentBase="card bg-surface-200-800 space-y-4 max-w-[320px]"
				arrow
				arrowBackground="!bg-surface-200 dark:!bg-surface-800"
			>
				{#snippet trigger()}
					Change Language
				{/snippet}
				{#snippet content()}
					<div class="mt-1 rounded-sm border border-gray-300 bg-white shadow-lg">
						{#each $locales as l}
							<button
								class="w-full p-2 text-left hover:bg-gray-100"
								onclick={() => locale.set(l)}
							>
								{localeMap[l]}
							</button>
						{/each}
					</div>
				{/snippet}
			</Popover>
		</div>
	</header>

	<main class="container mx-auto max-w-4xl px-4 py-8">
		<div class="rounded-lg border border-gray-300 bg-white p-8 shadow-sm">
			<h2 class="mb-6 text-2xl font-bold text-gray-900">Convert MIDI to DTX</h2>

			<div class="space-y-6">
				<!-- Upload Section -->
				<div class="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
					{#if !uploadedFile}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100"
							>
								<svg
									class="h-6 w-6 text-indigo-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-gray-900">Upload MIDI File</h3>
								<p class="text-gray-600">Select a .mid or .midi file to convert</p>
							</div>
							<button
								type="button"
								class="rounded-md bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-700"
								onclick={handleUploadClick}
							>
								Choose File
							</button>
						</div>
					{:else}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
							>
								<svg
									class="h-6 w-6 text-green-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-gray-900">File Ready</h3>
								<p class="text-gray-600">{uploadedFile.name}</p>
								<p class="text-sm text-gray-500">
									{(uploadedFile.size / 1024).toFixed(1)} KB
								</p>
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="rounded-md bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700"
									onclick={handleReset}
								>
									Remove
								</button>
								<button
									type="button"
									class="rounded-md bg-gray-600 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-700"
									onclick={handleUploadClick}
								>
									Choose Different File
								</button>
							</div>
						</div>
					{/if}

					<input
						bind:this={fileInput}
						type="file"
						accept=".mid,.midi,audio/midi"
						onchange={handleFileUpload}
						class="hidden"
					/>
				</div>

				<!-- Convert Section -->
				{#if uploadedFile}
					<div class="flex justify-center">
						<button
							type="button"
							class="flex items-center gap-2 rounded-md bg-indigo-600 px-8 py-3 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
							onclick={handleConvert}
							disabled={isConverting || isConverted}
						>
							{#if isConverting}
								<div
									class="h-4 w-4 animate-spin rounded-full border-b-2 border-white"
								></div>
								Converting...
							{:else if isConverted}
								✓ Converted
							{:else}
								Convert to DTX
							{/if}
						</button>
					</div>
				{/if}

				<!-- Download Section -->
				{#if isConverted}
					<div class="rounded-lg border-2 border-green-300 bg-green-50 p-6">
						<div class="space-y-4 text-center">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
							>
								<svg
									class="h-6 w-6 text-green-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-green-900">
									Conversion Complete!
								</h3>
								<p class="text-green-700">Your DTX file is ready for download</p>
								<p class="text-sm text-green-600">{convertedFileName}</p>
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="rounded-md bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700"
									onclick={handleDownload}
								>
									Download DTX File
								</button>
								<button
									type="button"
									class="rounded-md bg-gray-600 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-700"
									onclick={handleReset}
								>
									Convert Another File
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Info Section -->
		<div class="mt-8 rounded-lg border border-gray-300 bg-white p-6 shadow-sm">
			<h3 class="mb-3 text-lg font-semibold text-gray-900">About MIDI to DTX Conversion</h3>
			<div class="space-y-2 text-gray-700">
				<p>This tool converts MIDI files to DTX format for use in drum simulation games.</p>
				<p><strong>Supported input:</strong> .mid, .midi files</p>
				<p><strong>Output:</strong> .dtx files compatible with DTX rhythm games</p>
				<p>
					<strong>Note:</strong> Currently generates a basic DTX template. Full conversion
					logic will be implemented in future updates.
				</p>
			</div>
		</div>
	</main>
</div>
