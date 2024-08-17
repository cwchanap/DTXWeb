import { Scene } from "phaser";
import { MainMenu } from "./scenes/MainMenu";
import store from "@/lib/store";
import { get } from "svelte/store";

export class Preloader extends Scene {
    constructor() {
        super('Preloader');
    }

    init() {
        this.load.on('complete', () => {
            const activeScene = get(store.activeScene);
            this.scene.start(activeScene || MainMenu.key);
        });
    }

    preload() {
        // this.load.image('background', 'assets/background.png');
        // this.load.image('logo', 'assets/logo.png');
    }

    create() {
        this.add.text(20, 20, 'Loading game...');
    }
}