import Phaser from 'phaser';

import { EventBus } from '../EventBus';
import EventType from '../EventType';
export class MainMenu extends Phaser.Scene {
	background!: Phaser.GameObjects.Image;
	logo!: Phaser.GameObjects.Image;
	title!: Phaser.GameObjects.Text;
	logoTween!: Phaser.Tweens.Tween | null;
	toEditor!: Phaser.GameObjects.Text;

	public static key = 'MainMenu';

	constructor() {
		super(MainMenu.key);
	}

	create() {
		const height = this.game.canvas.height;
		const width = this.game.canvas.width;

		this.title = this.add
			.text(width / 2, height / 2 + 150, 'Start', {
				fontFamily: 'Arial Black',
				fontSize: 38,
				color: '#ffffff',
				stroke: '#000000',
				strokeThickness: 8,
				align: 'center'
			})
			.setOrigin(0.5)
			.setDepth(100)
			.setInteractive({ useHandCursor: true })
			.on('pointerdown', () => {
				alert('Under construction');
			});

		EventBus.emit(EventType.SCENE_READY, this);
	}
}
