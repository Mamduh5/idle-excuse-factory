import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { FactoryScene } from '../scenes/FactoryScene';
import { PreloadScene } from '../scenes/PreloadScene';

export function createGame(): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#f8ebcb',
    width: 390,
    height: 844,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      pixelArt: false,
      antialias: true,
      roundPixels: true,
    },
    scene: [BootScene, PreloadScene, FactoryScene],
  };

  return new Phaser.Game(config);
}
