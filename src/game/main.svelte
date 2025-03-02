<script module lang="ts">
	import type { Game, Scene } from 'phaser';

	export type TPhaserRef = {
		game: Game | null;
		scene: Scene | null;
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { EventBus } from './EventBus';
	import Phaser from 'phaser';
	import { config } from './main';
	import EventType from './EventType';

	const StartGame = (parent: string) => {
		return new Phaser.Game({ ...config, parent: parent });
	};

	interface Props {
		phaserRef?: TPhaserRef;
		currentActiveScene: (scene: Scene) => void;
	}

	let {
		phaserRef = $bindable({
			game: null,
			scene: null
		}),
		currentActiveScene
	}: Props = $props();

	onMount(() => {
		phaserRef.game = StartGame('game-container');
		EventBus.on(EventType.SCENE_READY, (scene_instance: Scene) => {
			phaserRef.scene = scene_instance;
			if (currentActiveScene) {
				currentActiveScene(scene_instance);
			}
		});
	});
</script>

<div id="game-container"></div>
