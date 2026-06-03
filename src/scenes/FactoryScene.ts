import Phaser from 'phaser';
import { customers } from '../data/customers';
import { excuses, starterExcuseIds } from '../data/excuses';
import { zones } from '../data/zones';
import { colors } from '../rendering/colors';
import { createInitialState } from '../state/initialState';
import {
  canRefillCustomerBatch,
  craftExcuse,
  getWaitingCustomerByInstanceId,
  getWantedExcuseIds,
  hasMatchingStock,
  refillCustomerBatch,
  serveCustomerByInstanceId,
} from '../systems/gameplay';
import type { CustomerDefinition, CustomerInstance, ExcuseId, GameState } from '../types/game';
import { createFactoryLayout, type FactoryLayout } from '../ui/FactoryLayout';
import { addButton, addLabel, addPanel } from '../ui/phaserUi';
import { inset, type Rect } from '../utils/layout';

const servedFeedbackDurationMs = 1500;

export class FactoryScene extends Phaser.Scene {
  private readonly state: GameState = createInitialState();
  private readonly customersById = new Map(customers.map((customer) => [customer.id, customer]));
  private uiGroup?: Phaser.GameObjects.Group;
  private toast?: Phaser.GameObjects.Text;
  private toastTween?: Phaser.Tweens.Tween;
  private servedFeedbackTimer?: Phaser.Time.TimerEvent;
  private selectedCustomerInstanceId?: string;

  public constructor() {
    super('FactoryScene');
  }

  public create(): void {
    this.renderFactory();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.renderFactory, this);
  }

  public destroy(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.renderFactory, this);
    this.servedFeedbackTimer?.remove();
  }

  private renderFactory(): void {
    this.clearInvalidSelection();
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
    const serveButtonWidth = layout.compact ? 72 : 118;
    const statusX = inner.x + (layout.compact ? 86 : 126);
    const statusWidth = inner.width - serveButtonWidth - (statusX - inner.x) - 8;
    const heading = addLabel(
      this,
      'Customer Queue',
      inner.x,
      inner.y,
      layout.compact ? 14 : 16,
      '#2b2018',
      inner.width - serveButtonWidth - 8,
    );
    const serveStatus = addLabel(
      this,
      this.getServeStatusText(),
      statusX,
      inner.y + (layout.compact ? 4 : 5),
      layout.compact ? 9 : 10,
      this.getSelectedCustomer() ? '#2b2018' : '#74594c',
      statusWidth,
    );
    serveStatus.setFontStyle('700');
    const serveAction = this.renderServeAction(
      {
        x: inner.x + inner.width - serveButtonWidth,
        y: inner.y - 1,
        width: serveButtonWidth,
        height: layout.compact ? 21 : 25,
      },
      layout.compact,
    );
    const slotGap = layout.compact ? 5 : 7;
    const slotTop = inner.y + (layout.compact ? 22 : 29);
    const slotHeight = Math.max(34, Math.floor((inner.height - (slotTop - inner.y) - slotGap * 2) / 3));
    const nowMs = Date.now();
    const queueCleared = this.isQueueCleared(nowMs);
    const slots = this.state.activeCustomers.slice(0, 3).flatMap((customer, index) => {
      const y = slotTop + index * (slotHeight + slotGap);
      return this.renderCustomerSlot(
        { x: inner.x, y, width: inner.width, height: slotHeight },
        customer,
        layout.compact,
        queueCleared,
        index,
        nowMs,
      );
    });

    this.addToUi(panel, heading, serveStatus, ...serveAction, ...slots);
  }

  private renderServeAction(rect: Rect, compact: boolean): Phaser.GameObjects.GameObject[] {
    if (!this.selectedCustomerInstanceId) {
      const disabled = addPanel(this, rect, colors.panelEmpty, 10);
      const hint = addLabel(this, compact ? 'เลือกก่อน' : 'เลือกก่อน', rect.x + rect.width / 2, rect.y + rect.height / 2 - 7, compact ? 9 : 10, '#74594c');
      hint.setOrigin(0.5, 0);
      return [disabled, hint];
    }

    const button = addButton(
      this,
      rect,
      compact ? 'เสิร์ฟ' : 'เสิร์ฟข้ออ้าง',
      () => this.handleServeSelected(),
      {
        fontSize: compact ? 10 : 12,
        fillColor: colors.panelServed,
        pressedColor: colors.accent,
      },
    );
    return button.group.getChildren();
  }

  private renderCustomerSlot(
    rect: Rect,
    customer: CustomerInstance,
    compact: boolean,
    queueCleared: boolean,
    slotIndex: number,
    nowMs: number,
  ): Phaser.GameObjects.GameObject[] {
    const definition = this.customersById.get(customer.customerId);
    const recentlyServed = this.isRecentlyServed(customer, nowMs);
    const selected = this.selectedCustomerInstanceId === customer.instanceId && customer.status === 'waiting';
    const bg = addPanel(
      this,
      rect,
      recentlyServed ? colors.panelServed : customer.status === 'served' ? colors.panelEmpty : colors.panel,
      10,
    );
    const selectedBorder = selected ? this.addSelectedBorder(rect) : undefined;

    if (definition && recentlyServed) {
      const sold = addLabel(this, 'ขายสำเร็จ!', rect.x + 10, rect.y + 6, compact ? 12 : 14, '#2b2018', rect.width * 0.42);
      const coins = addLabel(
        this,
        `+${customer.servedReward?.coins ?? 0} coins`,
        rect.x + rect.width * 0.52,
        rect.y + 6,
        compact ? 11 : 13,
        '#2b2018',
        rect.width * 0.42,
      );
      const smoothness = addLabel(
        this,
        `+${customer.servedReward?.smoothness ?? 0} ความเนียน`,
        rect.x + 10,
        rect.y + rect.height - (compact ? 17 : 20),
        compact ? 9 : 11,
        '#74594c',
        rect.width - 20,
      );
      coins.setFontStyle('800');
      smoothness.setFontStyle('700');
      return [bg, sold, coins, smoothness];
    }

    if (queueCleared && slotIndex === 2) {
      const buttonRect = inset(rect, compact ? 5 : 7);
      const button = addButton(
        this,
        buttonRect,
        compact ? 'ชุดต่อไป' : 'เรียกลูกค้าชุดต่อไป',
        () => this.handleNextBatch(),
        {
          fontSize: compact ? 10 : 12,
          fillColor: colors.accent,
          pressedColor: colors.accentPressed,
        },
      );
      return [bg, ...button.group.getChildren()];
    }

    if (!definition || customer.status === 'served') {
      const empty = addLabel(
        this,
        this.getEmptySlotText(queueCleared, slotIndex),
        rect.x + 10,
        rect.y + rect.height / 2 - (compact ? 8 : 10),
        compact ? 11 : 13,
        '#74594c',
        rect.width - 20,
      );
      empty.setFontStyle('700');
      return [bg, empty];
    }

    const title = definition.displayName;
    const wanted = excuses[customer.wantedExcuseId].displayName;
    const name = addLabel(this, title, rect.x + 10, rect.y + 6, compact ? 11 : 13, '#2b2018', rect.width * 0.58);
    const want = addLabel(
      this,
      selected ? 'เลือกแล้ว' : `ต้องการ: ${wanted}`,
      rect.x + rect.width * 0.56,
      rect.y + 6,
      compact ? 10 : 12,
      selected ? '#d97706' : '#74594c',
      rect.width * 0.42,
    );
    want.setFontStyle('700');
    const status = addLabel(
      this,
      selected ? `ต้องการ: ${wanted}` : this.getCustomerStatus(definition),
      rect.x + 10,
      rect.y + rect.height - (compact ? 17 : 20),
      compact ? 9 : 11,
      selected ? '#2b2018' : '#74594c',
      rect.width - 20,
    );
    status.setFontStyle(selected ? '800' : '500');
    const hitArea = this.add.zone(rect.x, rect.y, rect.width, rect.height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    hitArea.on('pointerup', () => this.selectCustomer(customer.instanceId));

    return [bg, ...(selectedBorder ? [selectedBorder] : []), name, want, status, hitArea];
  }

  private addSelectedBorder(rect: Rect): Phaser.GameObjects.Graphics {
    return this.add.graphics()
      .lineStyle(4, colors.accentPressed, 1)
      .strokeRoundedRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, 10);
  }

  private getEmptySlotText(queueCleared: boolean, slotIndex: number): string {
    if (!queueCleared) {
      return 'รอลูกค้าคนต่อไป...';
    }

    if (slotIndex === 0) {
      return 'ลูกค้าหมดคิวแล้ว';
    }

    if (slotIndex === 1) {
      return 'รอลูกค้าชุดต่อไป...';
    }

    return 'ผลิตเก็บสต็อกต่อได้';
  }

  private getCustomerStatus(customer: CustomerDefinition): string {
    return customer.problemText;
  }

  private isRecentlyServed(customer: CustomerInstance, nowMs: number): boolean {
    return customer.status === 'served'
      && customer.servedAtMs !== undefined
      && nowMs - customer.servedAtMs < servedFeedbackDurationMs;
  }

  private isQueueCleared(nowMs: number): boolean {
    return this.state.activeCustomers.length > 0
      && this.state.activeCustomers.every((customer) => customer.status === 'served')
      && this.state.activeCustomers.every((customer) => !this.isRecentlyServed(customer, nowMs));
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
        id,
        this.state.excuseStock[id],
        excuse.maxStock,
        layout.compact,
      );
    });

    this.addToUi(panel, heading, ...cards);
  }

  private renderExcuseCard(rect: Rect, excuseId: ExcuseId, stock: number, maxStock: number, compact: boolean): Phaser.GameObjects.GameObject[] {
    const selectedWants = this.selectedCustomerWants(excuseId);
    const ready = selectedWants && stock > 0;
    const bg = addPanel(this, rect, ready ? colors.panelServed : selectedWants ? colors.panelNeeded : colors.panel, 10);
    const border = selectedWants ? this.addCueBorder(rect, ready) : undefined;
    const label = excuses[excuseId].displayName;
    const countPrefix = selectedWants ? ready ? 'พร้อม' : 'ต้องใช้' : 'Stock';
    const title = addLabel(this, label, rect.x + 10, rect.y + (compact ? 6 : 7), compact ? 11 : 13, '#2b2018', rect.width * 0.55);
    const count = addLabel(this, `${countPrefix} ${stock}/${maxStock}`, rect.x + rect.width * 0.58, rect.y + (compact ? 6 : 7), compact ? 10 : 12, selectedWants ? '#2b2018' : '#74594c', rect.width * 0.39);
    count.setFontStyle('700');
    return [bg, ...(border ? [border] : []), title, count];
  }

  private renderCraftPanel(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.craftPanel, colors.craftPanel, 14);
    const inner = inset(layout.craftPanel, layout.compact ? 8 : 11);
    const heading = addLabel(this, 'Craft Panel', inner.x, inner.y, layout.compact ? 14 : 16, '#2b2018');
    const buttonGap = layout.compact ? 5 : 7;
    const buttonTop = inner.y + (layout.compact ? 22 : 30);
    const buttonHeight = Math.max(33, Math.min(44, Math.floor((inner.height - (buttonTop - inner.y) - buttonGap * 2) / 3)));
    const buttons = starterExcuseIds.map((id, index) => {
      const selectedWants = this.selectedCustomerWants(id);
      const stockMissing = selectedWants && this.state.excuseStock[id] <= 0;
      const label = stockMissing
        ? `ผลิต ${excuses[id].displayName} · ควรผลิต`
        : `ผลิต ${excuses[id].displayName}`;
      const y = buttonTop + index * (buttonHeight + buttonGap);
      return addButton(
        this,
        { x: inner.x, y, width: inner.width, height: buttonHeight },
        label,
        () => this.handleCraft(id),
        {
          fontSize: stockMissing ? layout.compact ? 10 : 12 : layout.compact ? 12 : 14,
          fillColor: stockMissing ? colors.panelNeeded : undefined,
          pressedColor: stockMissing ? colors.accent : undefined,
        },
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

  private handleCraft(excuseId: ExcuseId): void {
    const result = craftExcuse(this.state, excuseId);
    const excuse = excuses[excuseId];
    this.renderFactory();

    if (!result.crafted) {
      this.showToast('ข้ออ้างเต็มแล้ว!');
      return;
    }

    this.showToast(`ผลิต ${excuse.displayName} แล้ว ${result.stock}/${result.cap}`);
  }

  private handleNextBatch(): void {
    if (!canRefillCustomerBatch(this.state)) {
      this.showToast('ยังมีลูกค้ารออยู่');
      return;
    }

    const result = refillCustomerBatch(this.state);
    this.selectedCustomerInstanceId = undefined;
    this.renderFactory();

    if (!result.refilled) {
      this.showToast('ยังมีลูกค้ารออยู่');
      return;
    }

    this.showToast('เรียกลูกค้าชุดต่อไปแล้ว');
  }

  private handleServeSelected(): void {
    if (!this.selectedCustomerInstanceId) {
      this.showToast('เลือกลูกค้าก่อน');
      return;
    }

    const result = serveCustomerByInstanceId(this.state, this.selectedCustomerInstanceId);
    if (!result.served) {
      this.showToast('ยังไม่มีข้ออ้างที่ลูกค้าต้องการ');
      return;
    }

    this.selectedCustomerInstanceId = undefined;
    this.renderFactory();
    this.scheduleServedFeedbackRefresh();
    this.showToast(`ขายข้ออ้างสำเร็จ +${result.coinsGained} coins`);
  }

  private selectCustomer(instanceId: string): void {
    const customer = this.state.activeCustomers.find((candidate) => candidate.instanceId === instanceId);
    if (!customer || customer.status !== 'waiting') {
      return;
    }

    this.selectedCustomerInstanceId = instanceId;
    this.renderFactory();
    this.showToast('เลือกลูกค้าแล้ว');
  }

  private clearInvalidSelection(): void {
    if (!this.selectedCustomerInstanceId) {
      return;
    }

    const selected = this.state.activeCustomers.find((customer) => customer.instanceId === this.selectedCustomerInstanceId);
    if (!selected || selected.status !== 'waiting') {
      this.selectedCustomerInstanceId = undefined;
    }
  }

  private getSelectedCustomer(): CustomerInstance | undefined {
    return getWaitingCustomerByInstanceId(this.state, this.selectedCustomerInstanceId);
  }

  private getSelectedWantedExcuseIds(): ExcuseId[] {
    return getWantedExcuseIds(this.getSelectedCustomer());
  }

  private selectedCustomerWants(excuseId: ExcuseId): boolean {
    return this.getSelectedWantedExcuseIds().includes(excuseId);
  }

  private getServeStatusText(): string {
    const selected = this.getSelectedCustomer();
    if (!selected) {
      return 'เลือกลูกค้าก่อน';
    }

    return hasMatchingStock(this.state, selected) ? 'พร้อมเสิร์ฟ' : 'ต้องผลิตก่อน';
  }

  private addCueBorder(rect: Rect, ready: boolean): Phaser.GameObjects.Graphics {
    return this.add.graphics()
      .lineStyle(3, ready ? colors.readyBorder : colors.neededBorder, 1)
      .strokeRoundedRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, 10);
  }

  private scheduleServedFeedbackRefresh(): void {
    this.servedFeedbackTimer?.remove();
    this.servedFeedbackTimer = this.time.delayedCall(servedFeedbackDurationMs, () => {
      this.renderFactory();
    });
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
