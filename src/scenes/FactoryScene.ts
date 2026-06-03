import Phaser from 'phaser';
import { customers } from '../data/customers';
import { excuses, starterExcuseIds } from '../data/excuses';
import { zones } from '../data/zones';
import { colors } from '../rendering/colors';
import { createInitialState } from '../state/initialState';
import type { GameState } from '../types/game';
import { createFactoryLayout, type FactoryLayout } from '../ui/FactoryLayout';
import { addButton, addLabel, addPanel } from '../ui/phaserUi';
import { inset, type Rect } from '../utils/layout';

export class FactoryScene extends Phaser.Scene {
  private readonly state: GameState = createInitialState();
  private uiGroup?: Phaser.GameObjects.Group;
  private toast?: Phaser.GameObjects.Text;
  private toastTween?: Phaser.Tweens.Tween;

  public constructor() {
    super('FactoryScene');
  }

  public create(): void {
    this.renderFactory();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.renderFactory, this);
  }

  public destroy(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.renderFactory, this);
  }

  private renderFactory(): void {
    this.uiGroup?.destroy(true);
    this.toastTween?.stop();
    this.toast = undefined;

    const width = this.scale.width;
    const height = this.scale.height;
    const layout = createFactoryLayout(width, height);
    this.uiGroup = this.add.group();

    const background = this.add.graphics()
      .fillStyle(colors.background, 1)
      .fillRect(0, 0, width, height);
    this.uiGroup.add(background);

    this.renderHud(layout);
    this.renderTitle(layout);
    this.renderCustomerQueue(layout);
    this.renderExcuseCounter(layout);
    this.renderCraftPanel(layout);
    this.renderFooter(layout);
  }

  private addToUi(...items: Phaser.GameObjects.GameObject[]): void {
    this.uiGroup?.addMultiple(items);
  }

  private renderHud(layout: FactoryLayout): void {
    const currentZone = zones.find((zone) => zone.id === this.state.currentZoneId);
    const panel = addPanel(this, layout.hud, colors.hud, 14);
    const inner = inset(layout.hud, layout.compact ? 9 : 12);
    const fontSize = layout.compact ? 12 : 14;
    const columns = [
      `Coins: ${this.state.currencies.coins}`,
      `ความเนียน: ${this.state.currencies.smoothness}`,
      `Zone: ${currentZone?.displayName ?? 'Unknown'}`,
    ];
    const columnWidth = inner.width / columns.length;
    const labels = columns.map((label, index) => addLabel(
      this,
      label,
      inner.x + columnWidth * index,
      inner.y + inner.height / 2 - fontSize / 2,
      fontSize,
      '#fff7e6',
      columnWidth - 4,
    ));

    this.addToUi(panel, ...labels);
  }

  private renderTitle(layout: FactoryLayout): void {
    const rect = layout.title;
    const titleSize = layout.compact ? 18 : 22;
    const subtitleSize = layout.compact ? 11 : 13;
    const title = addLabel(this, 'Idle Excuse Factory', rect.x, rect.y + 2, titleSize, '#2b2018', rect.width);
    const subtitle = addLabel(
      this,
      'โรงงานข้ออ้าง',
      rect.x,
      rect.y + titleSize + (layout.compact ? 5 : 7),
      subtitleSize,
      '#74594c',
      rect.width,
    );
    subtitle.setFontStyle('700');
    this.addToUi(title, subtitle);
  }

  private renderCustomerQueue(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.customerQueue, colors.panelAlt, 14);
    const inner = inset(layout.customerQueue, layout.compact ? 8 : 11);
    const heading = addLabel(this, 'Customer Queue', inner.x, inner.y, layout.compact ? 14 : 16, '#2b2018');
    const slotGap = layout.compact ? 5 : 7;
    const slotTop = inner.y + (layout.compact ? 22 : 29);
    const slotHeight = Math.max(34, Math.floor((inner.height - (slotTop - inner.y) - slotGap * 2) / 3));
    const slots = customers.slice(0, 3).flatMap((customer, index) => {
      const y = slotTop + index * (slotHeight + slotGap);
      return this.renderCustomerSlot(
        { x: inner.x, y, width: inner.width, height: slotHeight },
        customer.displayName,
        excuses[customer.wantedExcuseId].displayName,
        layout.compact,
      );
    });

    this.addToUi(panel, heading, ...slots);
  }

  private renderCustomerSlot(rect: Rect, title: string, wanted: string, compact: boolean): Phaser.GameObjects.GameObject[] {
    const bg = addPanel(this, rect, colors.panel, 10);
    const name = addLabel(this, title, rect.x + 10, rect.y + 6, compact ? 11 : 13, '#2b2018', rect.width * 0.58);
    const want = addLabel(this, `ต้องการ: ${wanted}`, rect.x + rect.width * 0.58, rect.y + 6, compact ? 10 : 12, '#74594c', rect.width * 0.38);
    want.setFontStyle('700');
    const status = addLabel(this, 'รอลูกค้าคนต่อไป...', rect.x + 10, rect.y + rect.height - (compact ? 17 : 20), compact ? 9 : 11, '#74594c', rect.width - 20);
    status.setFontStyle('500');
    return [bg, name, want, status];
  }

  private renderExcuseCounter(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.excuseCounter, colors.greenPanel, 14);
    const inner = inset(layout.excuseCounter, layout.compact ? 8 : 11);
    const heading = addLabel(this, 'Excuse Counter', inner.x, inner.y, layout.compact ? 14 : 16, '#2b2018');
    const cardGap = layout.compact ? 5 : 7;
    const cardTop = inner.y + (layout.compact ? 22 : 29);
    const cardHeight = Math.max(30, Math.floor((inner.height - (cardTop - inner.y) - cardGap * 2) / 3));
    const cards = starterExcuseIds.flatMap((id, index) => {
      const excuse = excuses[id];
      const y = cardTop + index * (cardHeight + cardGap);
      return this.renderExcuseCard(
        { x: inner.x, y, width: inner.width, height: cardHeight },
        excuse.displayName,
        this.state.excuseStock[id],
        excuse.maxStock,
        layout.compact,
      );
    });

    this.addToUi(panel, heading, ...cards);
  }

  private renderExcuseCard(rect: Rect, label: string, stock: number, maxStock: number, compact: boolean): Phaser.GameObjects.GameObject[] {
    const bg = addPanel(this, rect, colors.panel, 10);
    const title = addLabel(this, label, rect.x + 10, rect.y + (compact ? 6 : 7), compact ? 11 : 13, '#2b2018', rect.width * 0.55);
    const count = addLabel(this, `Stock ${stock}/${maxStock}`, rect.x + rect.width * 0.62, rect.y + (compact ? 6 : 7), compact ? 10 : 12, '#74594c', rect.width * 0.35);
    count.setFontStyle('700');
    return [bg, title, count];
  }

  private renderCraftPanel(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.craftPanel, colors.craftPanel, 14);
    const inner = inset(layout.craftPanel, layout.compact ? 8 : 11);
    const heading = addLabel(this, 'Craft Panel', inner.x, inner.y, layout.compact ? 14 : 16, '#2b2018');
    const buttonGap = layout.compact ? 5 : 7;
    const buttonTop = inner.y + (layout.compact ? 22 : 30);
    const buttonHeight = Math.max(33, Math.min(44, Math.floor((inner.height - (buttonTop - inner.y) - buttonGap * 2) / 3)));
    const buttons = starterExcuseIds.map((id, index) => {
      const label = `ผลิต ${excuses[id].displayName}`;
      const y = buttonTop + index * (buttonHeight + buttonGap);
      return addButton(
        this,
        { x: inner.x, y, width: inner.width, height: buttonHeight },
        label,
        () => this.showToast(`${label} ยังเป็นตัวอย่าง`),
        { fontSize: layout.compact ? 12 : 14 },
      );
    });

    this.addToUi(panel, heading, ...buttons.flatMap((button) => button.group.getChildren()));
  }

  private renderFooter(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.footer, colors.footer, 14);
    const inner = inset(layout.footer, layout.compact ? 6 : 8);
    const labels = ['Upgrades', 'Zones', 'Archive', 'Settings'];
    const gap = 6;
    const width = (inner.width - gap * (labels.length - 1)) / labels.length;
    const buttons = labels.map((label, index) => addButton(
      this,
      {
        x: inner.x + index * (width + gap),
        y: inner.y,
        width,
        height: inner.height,
      },
      label,
      () => this.showToast(`${label} panel coming soon`),
      {
        fontSize: layout.compact ? 10 : 11,
        fillColor: 0xffdd75,
        pressedColor: colors.accent,
      },
    ));

    this.addToUi(panel, ...buttons.flatMap((button) => button.group.getChildren()));
  }

  private showToast(message: string): void {
    this.toastTween?.stop();
    this.toast?.destroy();

    const width = this.scale.width;
    const height = this.scale.height;
    this.toast = this.add.text(width / 2, height - 88, message, {
      fontFamily: 'system-ui, "Noto Sans Thai", Tahoma, sans-serif',
      fontSize: '14px',
      color: '#fff7e6',
      fontStyle: '800',
      backgroundColor: '#5a3528',
      padding: { x: 12, y: 8 },
      align: 'center',
    }).setOrigin(0.5).setAlpha(0);

    this.toastTween = this.tweens.add({
      targets: this.toast,
      alpha: { from: 0, to: 1 },
      y: height - 98,
      duration: 120,
      yoyo: true,
      hold: 950,
      onComplete: () => {
        this.toast?.destroy();
        this.toast = undefined;
      },
    });
  }
}
