<script lang="ts">
	import type { Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { goto } from '$app/navigation';
	import { Editor } from '@/game/scenes/Editor';

	let phaserRef: TPhaserRef = { game: null, scene: null };
    let measureCount = 9;
	// Event emitted from the PhaserGame component
	const currentScene = (scene: Scene) => {
		return scene
	};

    function handleMeasureChange(event: any) {
        const scene = phaserRef.scene?.scene.start(Editor.key, { measureCount: measureCount });
    }
</script>

<div id='app'>
    <div class="input-container">
        <label for="measure-input">Number of Measures:</label>
        <input id="measure-input" type="number" bind:value={measureCount} on:change={handleMeasureChange} />
    </div>
    <Main phaserRef={phaserRef} currentActiveScene={currentScene} />
    <div>
        <div>
            <button class="btn-xl variant-ringed-tertiary" on:click={() => {
                phaserRef.scene?.scene.start(Editor.key);
            }}>Editor</button>
        </div>
        <div>
            <button class="btn-xl variant-ringed-tertiary" on:click={() => {
                goto('/');
            }}>Main</button>
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