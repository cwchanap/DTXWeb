import { Scene } from "phaser";
import { MainMenu } from "./scenes/MainMenu";
import store from "@/lib/store";

export class Preloader extends Scene {
    constructor() {
        super('Preloader');
    }

    init() {
        this.load.on('complete', () => {
            (store.activeScene.subscribe((scene) => {
                this.scene.start(scene || MainMenu.key);
            }))();
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