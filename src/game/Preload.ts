import { Scene } from "phaser";

export class Preloader extends Scene {
    constructor() {
        super('Preloader');
    }

    init() {
        this.load.on('complete', () => {
            this.scene.start('MainMenu');
        });
    }
    
    preload() {
        // this.load.image('background', 'assets/background.png');
        // this.load.image('logo', 'assets/logo.png');
    }

    create() {
        this.add.text(20, 20, 'Loading game...');
        this.scene.start('MainMenu');
    }
}