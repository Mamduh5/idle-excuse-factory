import Phaser from 'phaser';
import { colors } from '../rendering/colors';
import type { Rect } from '../utils/layout';

export type ButtonHandle = {
  group: Phaser.GameObjects.Group;
  setPressed: (pressed: boolean) => void;
};

export function addPanel(
  scene: Phaser.Scene,
  rect: Rect,
  fillColor = colors.panel,
  radius = 14,
): Phaser.GameObjects.Graphics {
  return scene.add.graphics()
    .fillStyle(fillColor, 1)
    .lineStyle(2, colors.border, 1)
    .fillRoundedRect(rect.x, rect.y, rect.width, rect.height, radius)
    .strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
}

export function addLabel(
  scene: Phaser.Scene,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color = '#2b2018',
  width?: number,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: 'system-ui, "Noto Sans Thai", Tahoma, sans-serif',
    fontSize: `${fontSize}px`,
    color,
    fontStyle: '700',
    fixedWidth: width,
    align: 'left',
  });
}

export function addButton(
  scene: Phaser.Scene,
  rect: Rect,
  label: string,
  onPress: () => void,
  options: { fontSize?: number; fillColor?: number; pressedColor?: number } = {},
): ButtonHandle {
  const fillColor = options.fillColor ?? colors.accent;
  const pressedColor = options.pressedColor ?? colors.accentPressed;
  const group = scene.add.group();
  const shape = scene.add.graphics();
  const draw = (pressed: boolean): void => {
    shape.clear()
      .fillStyle(pressed ? pressedColor : fillColor, 1)
      .lineStyle(2, colors.border, 1)
      .fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 12)
      .strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
  };

  draw(false);
  const hitArea = scene.add.zone(rect.x, rect.y, rect.width, rect.height)
    .setOrigin(0)
    .setInteractive({ useHandCursor: true });
  const text = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, label, {
    fontFamily: 'system-ui, "Noto Sans Thai", Tahoma, sans-serif',
    fontSize: `${options.fontSize ?? 15}px`,
    color: '#2b2018',
    fontStyle: '800',
    align: 'center',
  }).setOrigin(0.5);

  hitArea.on('pointerdown', () => draw(true));
  hitArea.on('pointerup', () => {
    draw(false);
    onPress();
  });
  hitArea.on('pointerout', () => draw(false));

  group.addMultiple([shape, hitArea, text]);

  return {
    group,
    setPressed: draw,
  };
}
