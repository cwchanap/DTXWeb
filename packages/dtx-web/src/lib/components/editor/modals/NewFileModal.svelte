<script lang="ts">
	import { Modal } from '@dtx/ui-components/components';

	interface Props {
		show: boolean;
		onConfirm: () => void;
		onCancel?: () => void;
	}

	let { show = $bindable(), onConfirm, onCancel }: Props = $props();

	let wasOpen = show;
	$: {
		if (wasOpen && !show) {
			onCancel?.();
		}
		wasOpen = show;
	}
</script>

<Modal
	bind:open={show}
	title="Create New File"
	{onConfirm}
	confirmText="Create New"
	confirmVariant="danger"
>
	{#snippet children()}
		<div class="space-y-3">
			<p class="text-gray-700">
				Creating a new file will clear all unsaved changes to the current chart.
			</p>
			<p class="text-sm font-medium text-red-600">
				⚠️ This action cannot be undone. All temporary edits will be permanently lost.
			</p>
		</div>
	{/snippet}
</Modal>
