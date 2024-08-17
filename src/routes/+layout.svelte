<script>
	import '../app.pcss';
	import { initializeStores, Toast, Modal } from '@skeletonlabs/skeleton';
	import { computePosition, autoUpdate, offset, shift, flip, arrow } from '@floating-ui/dom';
	import { storePopup } from '@skeletonlabs/skeleton';
	import { inject } from '@vercel/analytics'
	storePopup.set({ computePosition, autoUpdate, offset, shift, flip, arrow });

	initializeStores();
	inject();
</script>

<Toast />
<Modal />
<slot />
