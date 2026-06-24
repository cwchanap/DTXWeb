<script lang="ts">
	import { X } from '@lucide/svelte';
	import { toastStore, type Toast } from '../../stores/toastStore';

	const tone = (kind: Toast['kind']) =>
		kind === 'error'
			? 'border-red/40 bg-red/10 text-red'
			: 'border-green/40 bg-green/10 text-green';
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
	{#each $toastStore as toast (toast.id)}
		<div
			class="border-hairline bg-surface-1 pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg {tone(
				toast.kind
			)}"
			role={toast.kind === 'error' ? 'alert' : 'status'}
			aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
		>
			<span class="flex-1">{toast.message}</span>
			<button
				type="button"
				class="text-faint hover:text-hi shrink-0 rounded p-0.5"
				aria-label="Dismiss notification"
				onclick={() => toastStore.dismiss(toast.id)}
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>
