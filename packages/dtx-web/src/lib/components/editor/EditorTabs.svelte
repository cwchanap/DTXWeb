<script lang="ts">
	import { ChevronDown } from '@lucide/svelte/icons';
	import { MainTab, PreviewTab, SoundTab } from '@dtx/common/components';

	interface Props {
		currentTab: number;
		isTabsCollapsed: boolean;
		isPreviewing: boolean;
		isEditorReady: boolean;
		simfileID: string;
		bucketUrl: string;
		onTabChange: (tabIndex: number) => void;
		onToggleCollapsed: () => void;
	}

	let {
		currentTab = $bindable(),
		isTabsCollapsed = $bindable(),
		isPreviewing,
		isEditorReady,
		simfileID,
		bucketUrl,
		onTabChange,
		onToggleCollapsed
	}: Props = $props();
</script>

<!-- Left tab panel - full width on small screens, 25% on large screens -->
<div class="w-full pt-4 2xl:w-[25%]">
	<div class="tab-container">
		<!-- Collapsible header -->
		<div class="border-b border-gray-200 bg-gray-50">
			<button
				class="focus:ring-primary-500 flex w-full items-center justify-between px-4 py-3 text-left font-medium text-gray-700 hover:bg-gray-100 focus:ring-2 focus:outline-none"
				onclick={onToggleCollapsed}
				aria-expanded={!isTabsCollapsed}
			>
				<span>Editor Tabs</span>
				<ChevronDown
					class="h-5 w-5 transform transition-transform duration-200 {isTabsCollapsed
						? 'rotate-0'
						: 'rotate-180'}"
				/>
			</button>
		</div>

		<!-- Collapsible content -->
		{#if !isTabsCollapsed}
			<div class="h-[600px] overflow-y-auto border border-gray-200 bg-white">
				<!-- Tab controls -->
				<div class="tab-list flex border-b border-gray-200">
					<button
						class="w-[15%] px-4 py-2 2xl:w-1/4 {currentTab === 0
							? 'bg-primary-500 text-white'
							: 'bg-gray-50 text-gray-700 hover:bg-gray-200 hover:text-gray-800'}"
						onclick={() => {
							currentTab = 0;
							onTabChange(0);
						}}
					>
						Main
					</button>
					{#if !isPreviewing}
						<button
							class="w-[15%] px-4 py-2 2xl:w-1/4 {currentTab === 1
								? 'bg-primary-500 text-white'
								: 'bg-gray-50 text-gray-700 hover:bg-gray-200 hover:text-gray-800'}"
							onclick={() => {
								currentTab = 1;
								onTabChange(1);
							}}
						>
							Sound
						</button>
					{/if}
					<button
						class="w-[15%] px-4 py-2 2xl:w-1/4 {currentTab === 2
							? 'bg-primary-500 text-white'
							: 'bg-gray-50 text-gray-700 hover:bg-gray-200 hover:text-gray-800'}"
						onclick={() => {
							currentTab = 2;
							onTabChange(2);
						}}
					>
						Preview
					</button>
				</div>

				<!-- Tab panels -->
				<div class="tab-content p-4">
					{#if currentTab === 0}
						<MainTab />
					{:else if currentTab === 1}
						<SoundTab {simfileID} theme="light" {bucketUrl} />
					{:else if currentTab === 2}
						<PreviewTab {isEditorReady} />
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
