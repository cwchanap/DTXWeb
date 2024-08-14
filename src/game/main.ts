import { Preloader } from './Preload';
import { MainMenu } from './scenes/MainMenu';
import { Editor } from './scenes/Editor';

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
export const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 960,
    height: 1080,
    parent: 'game-container',
    backgroundColor: '#444B4B',
    scene: [
        Preloader,
        MainMenu,
        Editor,
    ]
};