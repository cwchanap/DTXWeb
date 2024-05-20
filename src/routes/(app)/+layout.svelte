<script>
	import { AppBar, AppShell, AppRail, AppRailAnchor, AppRailTile } from '@skeletonlabs/skeleton';
	import '../../app.pcss';
	import Icon from '@iconify/svelte';
	let currentTile = 0;
</script>

<AppShell>
	<svelte:fragment slot="header">
		<AppBar>
			<svelte:fragment slot="lead">
				<AppRailAnchor href="/">
					<Icon icon="mdi-light:home"></Icon>
				</AppRailAnchor>
			</svelte:fragment>
			<svelte:fragment slot="trail"></svelte:fragment>
			<svelte:fragment slot="headline"></svelte:fragment>
		</AppBar>
	</svelte:fragment>
	<svelte:fragment slot="sidebarLeft">
		<AppRail>
			<!-- --- -->
			<AppRailTile bind:group={currentTile} name="tile-1" value={0} title="tile-1">
				<svelte:fragment slot="lead"></svelte:fragment>
				<span>Tile 1</span>
			</AppRailTile>
			<AppRailTile bind:group={currentTile} name="tile-2" value={1} title="tile-2">
				<svelte:fragment slot="lead"></svelte:fragment>
				<span>Tile 2</span>
			</AppRailTile>
			<AppRailTile bind:group={currentTile} name="tile-3" value={2} title="tile-3">
				<svelte:fragment slot="lead"></svelte:fragment>
				<span>Tile 3</span>
			</AppRailTile>
			<!-- --- -->
		</AppRail>
	</svelte:fragment>
	<slot />
</AppShell>
