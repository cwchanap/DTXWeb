<script lang="ts">
	import '../app.pcss';
	import { initializeStores, Toast, Modal } from '@skeletonlabs/skeleton';
	import { computePosition, autoUpdate, offset, shift, flip, arrow } from '@floating-ui/dom';
	import { storePopup } from '@skeletonlabs/skeleton';
	import { inject } from '@vercel/analytics'
	interface Props {
		children?: import('svelte').Snippet;
	}

	let { children }: Props = $props();
	storePopup.set({ computePosition, autoUpdate, offset, shift, flip, arrow });

	initializeStores();
	inject();
</script>

<Toast />
<Modal />
{@render children?.()}
