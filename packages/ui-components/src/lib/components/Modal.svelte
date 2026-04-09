<script lang="ts">
	import type { Snippet } from 'svelte';

	function portal(node: HTMLElement) {
		if (typeof document === 'undefined') {
			return { destroy() {} };
		}
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	type ModalSize = 'sm' | 'md' | 'lg';
	type ConfirmVariant = 'primary' | 'danger';

	let {
		open = $bindable(false),
		title,
		children,
		onConfirm,
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		confirmVariant = 'primary' as ConfirmVariant,
		size = 'md' as ModalSize
	} = $props<{
		open: boolean;
		title: string;
		children: Snippet;
		onConfirm?: () => void;
		confirmText?: string;
		cancelText?: string;
		confirmVariant?: ConfirmVariant;
		size?: ModalSize;
	}>();

	function closeModal() {
		open = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			closeModal();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeModal();
		}
	}

	function handleConfirm() {
		onConfirm?.();
		closeModal();
	}

	const sizeClasses: Record<ModalSize, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-lg'
	} as const;

	const confirmClasses: Record<ConfirmVariant, string> = {
		primary:
			'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
		danger: 'rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2'
	} as const;
</script>

{#if open}
	<div
		use:portal
		class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black backdrop-blur-sm"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-title"
		tabindex="-1"
	>
		<div
			class="relative mx-4 w-full rounded-lg bg-white p-6 shadow-xl {sizeClasses[
				size as ModalSize
			]}"
		>
			<div class="mb-4 flex items-center justify-between">
				<h3 id="modal-title" class="text-lg font-semibold text-gray-900">{title}</h3>
				<button
					onclick={closeModal}
					class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label="Close modal"
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path
							fill-rule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</div>

			<div class="mb-6">
				{@render children()}
			</div>

			{#if onConfirm}
				<div class="flex justify-end gap-3">
					<button
						type="button"
						onclick={closeModal}
						class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
					>
						{cancelText}
					</button>
					<button
						type="button"
						onclick={handleConfirm}
						class={confirmClasses[confirmVariant as ConfirmVariant]}
					>
						{confirmText}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
