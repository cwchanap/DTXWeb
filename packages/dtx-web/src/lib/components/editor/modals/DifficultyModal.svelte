<script lang="ts">
	interface LevelOption {
		level: number;
		label: string;
		isActive: boolean;
	}

	interface Props {
		show: boolean;
		availableLevels: LevelOption[];
		onSwitchLevel: (level: number) => void;
		onClose: () => void;
	}

	let { show, availableLevels, onSwitchLevel, onClose }: Props = $props();
</script>

{#if show}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
			<h2 class="mb-4 text-xl font-bold text-gray-800">Switch Difficulty</h2>

			<div class="space-y-2">
				{#each availableLevels as { level, label, isActive }}
					<button
						class="w-full rounded-md border px-4 py-3 text-left transition-colors {isActive
							? 'border-blue-500 bg-blue-50 text-blue-700'
							: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
						onclick={() => onSwitchLevel(level)}
						disabled={isActive}
					>
						<div class="flex items-center justify-between">
							<div>
								<div class="font-medium">{label}</div>
								<div class="text-sm text-gray-500">Level {level}</div>
							</div>
							{#if isActive}
								<span class="text-sm font-medium text-blue-600">Current</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
					onclick={onClose}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
