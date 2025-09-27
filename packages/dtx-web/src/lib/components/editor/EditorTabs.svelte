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
		<div class="border-b border-purple-500/30 bg-slate-800/80 backdrop-blur-sm">
			<button
				class="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-slate-200 transition-colors hover:bg-slate-700/50 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
				onclick={onToggleCollapsed}
				aria-expanded={!isTabsCollapsed}
			>
				<span>Editor Tabs</span>
				<ChevronDown
					class="h-5 w-5 transform text-purple-300 transition-transform duration-200 {isTabsCollapsed
						? 'rotate-0'
						: 'rotate-180'}"
				/>
			</button>
		</div>

		<!-- Collapsible content -->
		{#if !isTabsCollapsed}
			<div
				class="h-[600px] overflow-y-auto border border-purple-500/30 bg-slate-900/50 backdrop-blur-sm"
			>
				<!-- Tab controls -->
				<div class="tab-list flex border-b border-purple-500/30">
					<button
						class="w-[15%] px-4 py-2 transition-colors 2xl:w-1/4 {currentTab === 0
							? 'border-b-2 border-cyan-400 bg-purple-600 text-white'
							: 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:text-slate-200'}"
						onclick={() => {
							currentTab = 0;
							onTabChange(0);
						}}
					>
						Main
					</button>
					{#if !isPreviewing}
						<button
							class="w-[15%] px-4 py-2 transition-colors 2xl:w-1/4 {currentTab === 1
								? 'border-b-2 border-cyan-400 bg-purple-600 text-white'
								: 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:text-slate-200'}"
							onclick={() => {
								currentTab = 1;
								onTabChange(1);
							}}
						>
							Sound
						</button>
					{/if}
					<button
						class="w-[15%] px-4 py-2 transition-colors 2xl:w-1/4 {currentTab === 2
							? 'border-b-2 border-cyan-400 bg-purple-600 text-white'
							: 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:text-slate-200'}"
						onclick={() => {
							currentTab = 2;
							onTabChange(2);
						}}
					>
						Preview
					</button>
				</div>

				<!-- Tab panels -->
				<div class="tab-content bg-slate-900/30 p-4">
					{#if currentTab === 0}
						<MainTab />
					{:else if currentTab === 1}
						<SoundTab {simfileID} theme="dark" {bucketUrl} />
					{:else if currentTab === 2}
						<PreviewTab {isEditorReady} />
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
