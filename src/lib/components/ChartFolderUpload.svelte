<script lang="ts">
	import { FileUpload } from '@skeletonlabs/skeleton-svelte';
	import type { DTXFile } from '../chart/dtx';
	import { SimFile } from '../chart/simFile';
	import { filterFiles } from '../utils';
	import IconUpload from '@lucide/svelte/icons/upload';
	import IconDropzone from '@lucide/svelte/icons/image-plus';
	import IconFile from '@lucide/svelte/icons/paperclip';
	import IconRemove from '@lucide/svelte/icons/circle-x';

	let simfile: SimFile;
	let highestDtx: DTXFile;
	interface Props {
		large?: boolean;
		onFileUpload: (simfile: SimFile, highestDtx: DTXFile) => void; // Add this
	}

	let { large = false, onFileUpload }: Props = $props();
	const acceptFilesType = ['.ogg', '.dtx', '.def', '.jpg', '.avi', '.mp4', '.mp3', '.xa'];

	async function handleFileInput(details: any) {
		const { acceptedFiles } = details;
		if (acceptedFiles) {
			simfile = new SimFile(acceptedFiles);
			await simfile.parse();
			simfile = simfile;
			highestDtx = simfile.getHighestLevel();
			onFileUpload(simfile, highestDtx);
		}
	}
</script>

{#if large}
	<FileUpload
		onFileChange={handleFileInput}
		directory
		accept={acceptFilesType}
		maxFiles={99}
		classes="w-full h-full"
	>
		{#snippet iconInterface()}<IconDropzone class="size-8" />{/snippet}
		{#snippet iconFile()}<IconFile class="size-4" />{/snippet}
		{#snippet iconFileRemove()}<IconRemove class="size-4" />{/snippet}
	</FileUpload>
{:else}
	<FileUpload onFileChange={handleFileInput} directory accept={acceptFilesType} maxFiles={99}>
		<button class="btn preset-filled">
			<IconUpload class="size-4" />
			<span>Select File</span>
		</button>
	</FileUpload>
{/if}
