import Phaser from 'phaser';
import { colors } from '../rendering/colors';
import type { Rect } from '../utils/layout';
import { addButton, addLabel, addPanel } from './phaserUi';

export const modalDepth = 1000;

export type ModalPanelHandle = {
  addContent: (...items: Phaser.GameObjects.GameObject[]) => void;
  contentRect: Rect;
  destroy: () => void;
  group: Phaser.GameObjects.Group;
  panelRect: Rect;
};

type ModalPanelOptions = {
  depth?: number;
  onClose: () => void;
  subtitle?: string;
  title: string;
};

type DepthCapableGameObject = Phaser.GameObjects.GameObject & {
  setDepth: (depth: number) => Phaser.GameObjects.GameObject;
};

export function createModalPanel(scene: Phaser.Scene, options: ModalPanelOptions): ModalPanelHandle {
  const depth = options.depth ?? modalDepth;
  const width = scene.scale.width;
  const height = scene.scale.height;
  const compact = height < 720;
  const group = scene.add.group();

  const dim = scene.add.graphics()
    .setDepth(depth)
    .fillStyle(0x2b2018, 0.28)
    .fillRect(0, 0, width, height);
  const inputBlocker = scene.add.zone(0, 0, width, height)
    .setOrigin(0)
    .setDepth(depth)
    .setInteractive();
  inputBlocker.on('pointerup', () => {
    // Blocks background input. Outside-tap close can be added by the caller later.
  });
  group.addMultiple([dim, inputBlocker]);

  const margin = Math.max(14, Math.min(26, Math.round(width * 0.055)));
  const panelWidth = Math.min(width - margin * 2, 344);
  const panelHeight = Math.min(height - margin * 2, compact ? 356 : 408);
  const panelRect: Rect = {
    x: (width - panelWidth) / 2,
    y: (height - panelHeight) / 2,
    width: panelWidth,
    height: panelHeight,
  };
  const headerHeight = compact ? 54 : 64;
  const contentRect: Rect = {
    x: panelRect.x + 18,
    y: panelRect.y + headerHeight + (compact ? 14 : 20),
    width: panelRect.width - 36,
    height: panelRect.height - headerHeight - (compact ? 44 : 58),
  };

  const panel = addPanel(scene, panelRect, colors.panel, 18, { borderColor: colors.border, borderWidth: 1 });
  const header = scene.add.graphics()
    .fillStyle(colors.hud, 1)
    .fillRoundedRect(panelRect.x, panelRect.y, panelRect.width, headerHeight, 18)
    .fillRect(panelRect.x, panelRect.y + headerHeight - 18, panelRect.width, 18);
  const title = addLabel(scene, options.title, panelRect.x + 18, panelRect.y + (compact ? 14 : 17), compact ? 18 : 21, '#fff7e6', panelRect.width - 82);
  const subtitle = options.subtitle
    ? addLabel(scene, options.subtitle, panelRect.x + 18, panelRect.y + (compact ? 36 : 44), compact ? 10 : 11, '#fff7e6', panelRect.width - 92)
    : undefined;

  const closeSize = compact ? 32 : 36;
  const closeButton = addButton(
    scene,
    {
      x: panelRect.x + panelRect.width - closeSize - 14,
      y: panelRect.y + (headerHeight - closeSize) / 2,
      width: closeSize,
      height: closeSize,
    },
    'X',
    options.onClose,
    {
      fontSize: compact ? 14 : 16,
      fillColor: colors.panelAlt,
      pressedColor: colors.panelNeeded,
    },
  );

  const chromeItems = [
    panel,
    header,
    title,
    ...(subtitle ? [subtitle] : []),
    ...closeButton.group.getChildren(),
  ];

  const addContent = (...items: Phaser.GameObjects.GameObject[]): void => {
    setDepth(items, depth + 1);
    group.addMultiple(items);
  };

  setDepth(chromeItems, depth + 1);
  group.addMultiple(chromeItems);

  return {
    addContent,
    contentRect,
    destroy: () => group.destroy(true),
    group,
    panelRect,
  };
}

function setDepth(items: Phaser.GameObjects.GameObject[], depth: number): void {
  items.forEach((item) => {
    (item as DepthCapableGameObject).setDepth(depth);
  });
}
