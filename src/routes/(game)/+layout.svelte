<svelte:head>
	<title>Game</title>
</svelte:head>

<div id="app" class="min-h-screen px-16 py-4">
	<slot />
</div>

<style>
	/* :global(body) {
        background-color: #0cc9bd;
        margin: 0;
        padding: 0;
        color: rgba(255, 255, 255, 0.87);
        background-color: #000000;
        font-family: Arial, Helvetica, sans-serif;
    } */
	#app {
		width: 100%;
		height: 100vh;
		overflow: hidden;
	}
</style>
