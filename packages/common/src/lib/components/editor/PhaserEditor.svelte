<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Phaser from 'phaser';
	import { Editor } from '../../game-client.js';
	import type { LaneMeasureNote } from '../../chart/note.js';

	interface Props {
		measureCount?: number;
		notes?: Record<string, LaneMeasureNote[]>;
		bpmNotes?: Record<string, number>;
		onNotesUpdate?: (notes: Record<string, LaneMeasureNote[]>) => void;
	}

	let { measureCount = 10, notes = {}, bpmNotes = {}, onNotesUpdate }: Props = $props();

	let gameContainer: HTMLDivElement;
	let game: Phaser.Game | null = null;
	let editorScene: Editor | null = null;

	onMount(() => {
		if (!gameContainer) return;

		// Phaser game configuration
		const config: Phaser.Types.Core.GameConfig = {
			type: Phaser.AUTO,
			width: 800,
			height: 600,
			parent: gameContainer,
			backgroundColor: '#2c3e50',
			scene: [Editor],
			physics: {
				default: 'arcade',
				arcade: {
					gravity: { x: 0, y: 0 },
					debug: false
				}
			}
		};

		// Create the Phaser game
		game = new Phaser.Game(config);

		// Add the Editor scene but don't start it yet
		const editorInstance = new Editor(measureCount);

		// Set the notes BEFORE starting the scene
		editorInstance.notes = { ...notes };

		game.scene.add(Editor.key, editorInstance, true); // true = start immediately
		editorScene = game.scene.getScene(Editor.key) as Editor;

		// Set up periodic sync of notes back to parent
		const syncInterval = setInterval(() => {
			if (editorScene && onNotesUpdate) {
				onNotesUpdate(editorScene.getNotes());
			}
		}, 1000); // Sync every second

		// Clean up interval on destroy
		onDestroy(() => {
			clearInterval(syncInterval);
		});
	});

	onDestroy(() => {
		if (game) {
			game.destroy(true);
			game = null;
		}
	});

	// Watch for external notes updates
	$effect(() => {
		if (editorScene && notes && Object.keys(notes).length > 0) {
			// Update notes and restart scene
			editorScene.notes = { ...notes };
			editorScene.measureCount = measureCount;
			editorScene.scene.restart({ measureCount });
		}
	});

	// Watch for measure count updates
	$effect(() => {
		if (editorScene && measureCount) {
			editorScene.scene.restart({ measureCount });
		}
	});
</script>

<div class="phaser-editor-container">
	<div bind:this={gameContainer} class="game-container"></div>
</div>

<style>
	.phaser-editor-container {
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: #2c3e50;
	}

	.game-container {
		width: 100%;
		height: 100%;
		max-width: 100%;
		max-height: 100%;
	}

	:global(.game-container canvas) {
		width: 100% !important;
		height: 100% !important;
	}
</style>
