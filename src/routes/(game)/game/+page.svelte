<script lang="ts">
	import type { Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';

	let phaserRef: TPhaserRef = { game: null, scene: null };
	// Event emitted from the PhaserGame component
	const currentScene = (scene: Scene) => {
		scene
	};
</script>

<div id='app'>
    <Main phaserRef={phaserRef} currentActiveScene={currentScene} />
    <div>
        <div>
            <button class="btn-xl variant-ringed-tertiary" on:click={() => {
                phaserRef.scene?.scene.start('Editor');
            }}>Editor</button>
        </div>
        <div>
            <button class="btn-xl variant-ringed-tertiary" on:click={() => {
                window.location.href = '/admin';
            }}>Admin</button>
        </div>
    </div>
</div>

<style>
    #app {
        width: 100%;
        height: 100vh;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    [class^="btn-"] {
        width: 140px;
        margin: 10px;
        padding: 10px;
        background-color: #000000;
        cursor: pointer;
        transition: all 0.3s;

        /* &:hover {
            border: 1px solid #0ec3c9;
            color: #0ec3c9;
        } */
    }
</style>