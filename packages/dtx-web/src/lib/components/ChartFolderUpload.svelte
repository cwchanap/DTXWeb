<script lang="ts">
	import { FileUpload } from '@skeletonlabs/skeleton-svelte';
	import { SimFile, type DTXFile } from '@dtx/common';
	import { filterFiles } from '../utils';
	import IconDropzone from '@lucide/svelte/icons/image-plus';
	import IconFile from '@lucide/svelte/icons/paperclip';
	import IconRemove from '@lucide/svelte/icons/circle-x';

	let simfile: SimFile;
	let highestDtx: DTXFile;
	interface Props {
		large?: boolean;
		button?: import('svelte').Snippet;
		onFileUpload: (simfile: SimFile, highestDtx: DTXFile) => void; // Add this
	}

	let { large = false, button, onFileUpload }: Props = $props();
	const acceptFilesType = ['.ogg', '.dtx', '.def', '.jpg', '.avi', '.mp4', '.mp3', '.xa'];

	async function handleFileInput(details: { acceptedFiles: File[] }) {
		const { acceptedFiles } = details;
		const filteredFiles = filterFiles(acceptedFiles, acceptFilesType);
		if (filteredFiles.length > 0) {
			simfile = new SimFile(filteredFiles);
			await simfile.parse();
			highestDtx = simfile.getHighestLevel();
			onFileUpload(simfile, highestDtx);
		}
	}
</script>

{#if large}
	<FileUpload onFileChange={handleFileInput} directory maxFiles={99} classes="w-full h-full">
		{#snippet iconInterface()}<IconDropzone class="size-8" />{/snippet}
		{#snippet iconFile()}<IconFile class="size-4" />{/snippet}
		{#snippet iconFileRemove()}<IconRemove class="size-4" />{/snippet}
	</FileUpload>
{:else}
	<FileUpload onFileChange={handleFileInput} directory maxFiles={99}>
		{@render button?.()}
	</FileUpload>
{/if}
