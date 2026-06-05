import Phaser from 'phaser';
import { customers } from '../data/customers';
import { excuses, starterExcuseIds } from '../data/excuses';
import { upgrades } from '../data/upgrades';
import { zones } from '../data/zones';
import { colors } from '../rendering/colors';
import { devSaveSeedDefinitions, writeDevSaveSeed, type DevSaveSeedDefinition } from '../services/devSaveSeeds';
import { clearSavedGame, loadGameState, saveGameState, type LoadSaveResult } from '../services';
import { createInitialState } from '../state/initialState';
import {
  addTimedCustomerArrival,
  canRefillCustomerBatch,
  completeCrafts,
  craftExcuse,
  expireCustomerPatience,
  getNextCustomerArrivalRemainingMs,
  getCustomerPatienceRemainingMs,
  getWaitingCustomerByInstanceId,
  getWantedExcuseIds,
  hasCustomerArrivalRoom,
  hasMatchingStock,
  refillCustomerBatch,
  serveCustomerByInstanceId,
} from '../systems/gameplay';
import { calculateOfflineEarnings, type OfflineEarningsResult } from '../systems/offlineEarnings';
import {
  calculateUpgradeCost,
  getExcuseStockCap,
  getUpgradeLevel,
  purchaseUpgrade,
} from '../systems/upgrades';
import type { CustomerDefinition, CustomerInstance, ExcuseId, GameState, UpgradeDefinition } from '../types/game';
import { createFactoryLayout, type FactoryLayout } from '../ui/FactoryLayout';
import { createModalPanel, modalDepth, type ModalPanelHandle } from '../ui/ModalPanel';
import { addButton, addLabel, addPanel } from '../ui/phaserUi';
import { inset, type Rect } from '../utils/layout';

const servedFeedbackDurationMs = 1500;
const stockFlashDurationMs = 600;
const autosaveIntervalMs = 12000;
type ViteImportMeta = ImportMeta & { env: { DEV: boolean } };
const devQaEnabled = (import.meta as ViteImportMeta).env.DEV;
type StockFlashKind = 'craft' | 'consume';
type ActiveModal = 'settings' | 'upgrades' | 'zones' | 'archive' | 'offlineEarnings';

export class FactoryScene extends Phaser.Scene {
  private state: GameState = createInitialState();
  private readonly customersById = new Map(customers.map((customer) => [customer.id, customer]));
  private uiGroup?: Phaser.GameObjects.Group;
  private modalPanel?: ModalPanelHandle;
  private activeModal?: ActiveModal;
  private autosaveTimer?: Phaser.Time.TimerEvent;
  private toast?: Phaser.GameObjects.Text;
  private toastTween?: Phaser.Tweens.Tween;
  private servedFeedbackTimer?: Phaser.Time.TimerEvent;
  private stockFlashTimer?: Phaser.Time.TimerEvent;
  private stockFlashExcuseId?: ExcuseId;
  private stockFlashKind?: StockFlashKind;
  private offlineEarnings?: OfflineEarningsResult;
  private lastPatienceRenderSecond = -1;
  private resetSaveArmed = false;
  private selectedCustomerInstanceId?: string;

  public constructor() {
    super('FactoryScene');
  }

  public create(): void {
    const nowMs = Date.now();
    const loadResult = loadGameState(nowMs);
    this.state = loadResult.state;
    const offlineEarnings = this.applyOfflineEarningsOnLoad(loadResult, nowMs);
    this.renderFactory();
    if (offlineEarnings) {
      this.openOfflineEarningsModal(offlineEarnings);
    } else {
      this.showToast(loadResult.status === 'loaded' ? 'โหลดเซฟสำเร็จ' : 'เริ่มเกมใหม่');
    }
    this.autosaveTimer = this.time.addEvent({
      delay: autosaveIntervalMs,
      loop: true,
      callback: () => this.saveProgress(),
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.renderFactory, this);
  }

  public destroy(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.renderFactory, this);
    this.autosaveTimer?.remove();
    this.servedFeedbackTimer?.remove();
    this.stockFlashTimer?.remove();
  }

  public update(): void {
    const nowMs = Date.now();
    const currentSecond = Math.floor(nowMs / 1000);
    if (currentSecond === this.lastPatienceRenderSecond) {
      return;
    }

    this.lastPatienceRenderSecond = currentSecond;
    const arrivalResult = addTimedCustomerArrival(this.state, nowMs);
    const craftResult = completeCrafts(this.state, nowMs);
    const hasActiveCrafts = this.hasActiveCrafts();
    const hasWaitingCustomers = this.state.activeCustomers.some((customer) => customer.status === 'waiting');
    const hasArrivalRoom = hasCustomerArrivalRoom(this.state);
    if (!hasWaitingCustomers && !hasActiveCrafts && craftResult.completed.length === 0 && !arrivalResult.arrived && !hasArrivalRoom) {
      return;
    }

    const result = hasWaitingCustomers ? expireCustomerPatience(this.state, nowMs) : { expiredInstanceIds: [] };
    const selectedExpired = this.selectedCustomerInstanceId !== undefined
      && result.expiredInstanceIds.includes(this.selectedCustomerInstanceId);
    if (selectedExpired) {
      this.selectedCustomerInstanceId = undefined;
    }

    const grantedCraft = craftResult.completed.find((craft) => craft.granted);
    if (grantedCraft) {
      this.scheduleStockFlash(grantedCraft.excuseId, 'craft');
    }

    if (result.expiredInstanceIds.length > 0 || craftResult.completed.length > 0 || arrivalResult.arrived) {
      this.saveProgress();
    }

    this.renderFactory();
    if (grantedCraft) {
      this.showToast(`ผลิต ${excuses[grantedCraft.excuseId].displayName} แล้ว ${grantedCraft.stock}/${grantedCraft.cap}`);
    } else if (result.expiredInstanceIds.length > 0) {
      this.showToast('ลูกค้ารอไม่ไหวแล้ว...');
    } else if (arrivalResult.arrived) {
      const customerName = arrivalResult.customer
        ? this.customersById.get(arrivalResult.customer.customerId)?.displayName
        : undefined;
      this.showToast(customerName ? `${customerName} เข้าคิวแล้ว` : 'ลูกค้าเข้าคิวแล้ว');
    }
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
      .fillRect(0, 0, width, height)
      .fillStyle(colors.backgroundBand, 0.45)
      .fillRect(0, 0, width, Math.round(height * 0.22))
      .fillStyle(colors.greenPanel, 0.28)
      .fillRect(0, Math.round(height * 0.68), width, Math.round(height * 0.32));
    this.uiGroup.add(background);

    this.renderHud(layout);
    this.renderTitle(layout);
    this.renderCustomerQueue(layout);
    this.renderExcuseCounter(layout);
    this.renderCraftPanel(layout);
    this.renderFooter(layout);
    this.renderActiveModal();
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
    const inner = inset(layout.customerQueue, layout.compact ? 7 : 11);
    const serveButtonWidth = layout.compact ? 76 : 116;
    const headerWidth = inner.width - serveButtonWidth - 10;
    const heading = addLabel(
      this,
      'Customer Queue',
      inner.x,
      inner.y,
      layout.compact ? 13 : 16,
      '#2b2018',
      headerWidth,
    );
    const nowMs = Date.now();
    const arrivalHint = this.getCustomerArrivalHintText(nowMs);
    const serveStatus = addLabel(
      this,
      arrivalHint ? `${this.getServeStatusText()} · ${arrivalHint}` : this.getServeStatusText(),
      inner.x,
      inner.y + (layout.compact ? 17 : 21),
      layout.compact ? 8 : 10,
      this.getSelectedCustomer() ? '#2b2018' : '#74594c',
      headerWidth,
    );
    serveStatus.setFontStyle('700');
    const serveAction = this.renderServeAction(
      {
        x: inner.x + inner.width - serveButtonWidth,
        y: inner.y,
        width: serveButtonWidth,
        height: layout.compact ? 27 : 30,
      },
      layout.compact,
    );
    const slotGap = layout.compact ? 4 : 7;
    const slotTop = inner.y + (layout.compact ? 34 : 39);
    const slotHeight = Math.max(layout.compact ? 40 : 48, Math.floor((inner.height - (slotTop - inner.y) - slotGap * 2) / 3));
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
      const hint = addLabel(this, 'เลือก', rect.x + 8, rect.y + rect.height / 2 - (compact ? 6 : 7), compact ? 9 : 10, '#74594c', rect.width - 16);
      hint.setAlign('center');
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
    const left = customer.status === 'left';
    const bg = addPanel(
      this,
      rect,
      recentlyServed ? colors.panelServed : left ? colors.panelNeeded : customer.status === 'served' ? colors.panelEmpty : colors.panel,
      10,
    );
    const selectedBorder = selected ? this.addSelectedBorder(rect) : undefined;

    if (definition && recentlyServed) {
      const consumedExcuse = customer.servedReward?.consumedExcuseId
        ? excuses[customer.servedReward.consumedExcuseId].displayName
        : '-';
      const sold = addLabel(this, 'ขายสำเร็จ!', rect.x + 10, rect.y + (compact ? 5 : 7), compact ? 10 : 13, '#2b2018', rect.width * 0.42);
      const coins = addLabel(
        this,
        `+${customer.servedReward?.coins ?? 0} coins`,
        rect.x + rect.width * 0.52,
        rect.y + (compact ? 5 : 7),
        compact ? 9 : 12,
        '#2b2018',
        rect.width * 0.42,
      );
      const used = addLabel(
        this,
        `ใช้ข้ออ้าง: ${consumedExcuse}`,
        rect.x + 10,
        rect.y + rect.height / 2 - (compact ? 5 : 8),
        compact ? 8 : 10,
        '#2b2018',
        rect.width - 20,
      );
      const smoothness = addLabel(
        this,
        `+${customer.servedReward?.smoothness ?? 0} ความเนียน`,
        rect.x + 10,
        rect.y + rect.height - (compact ? 13 : 18),
        compact ? 8 : 10,
        '#74594c',
        rect.width - 20,
      );
      coins.setFontStyle('800');
      used.setFontStyle('700');
      smoothness.setFontStyle('700');
      return [bg, sold, coins, used, smoothness];
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

    if (definition && left) {
      const leftTitle = addLabel(this, 'ลูกค้ารอไม่ไหวแล้ว...', rect.x + 10, rect.y + (compact ? 6 : 8), compact ? 10 : 13, '#2b2018', rect.width - 20);
      const leftText = addLabel(
        this,
        'เดินหนีไปแล้ว · ไม่มีค่าปรับ',
        rect.x + 10,
        rect.y + rect.height - (compact ? 15 : 20),
        compact ? 8 : 11,
        '#74594c',
        rect.width - 20,
      );
      leftTitle.setFontStyle('800');
      leftText.setFontStyle('700');
      return [bg, leftTitle, leftText];
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
    const wanted = this.formatWantedExcuseNames(customer.wantedExcuseIds);
    const patienceRemainingMs = getCustomerPatienceRemainingMs(customer, nowMs);
    const patienceSeconds = Math.ceil(patienceRemainingMs / 1000);
    const lowPatience = patienceRemainingMs <= 10_000;
    const padX = compact ? 8 : 10;
    const name = addLabel(this, title, rect.x + padX, rect.y + (compact ? 5 : 7), compact ? 10 : 13, '#2b2018', rect.width - (compact ? 86 : 108));
    const patience = addLabel(
      this,
      `${patienceSeconds}s`,
      rect.x + rect.width - (compact ? 54 : 66),
      rect.y + (compact ? 5 : 8),
      compact ? 9 : 11,
      lowPatience ? '#d97706' : '#2f7d32',
      compact ? 46 : 58,
    );
    patience.setFontStyle('900');
    const status = addLabel(
      this,
      this.getCustomerStatus(definition),
      rect.x + padX,
      rect.y + (compact ? 18 : 25),
      compact ? 7 : 9,
      selected ? '#2b2018' : '#74594c',
      rect.width - padX * 2,
    );
    const want = addLabel(
      this,
      selected ? `เลือกแล้ว · ต้องการ: ${wanted}` : `ต้องการ: ${wanted}`,
      rect.x + padX,
      rect.y + rect.height - (compact ? 12 : 15),
      compact ? 7 : 8,
      selected ? '#d97706' : '#2b2018',
      rect.width - padX * 2,
    );
    want.setFontStyle(selected ? '900' : '800');
    status.setFontStyle(selected ? '800' : '500');
    const hitArea = this.add.zone(rect.x, rect.y, rect.width, rect.height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    hitArea.on('pointerup', () => this.selectCustomer(customer.instanceId));

    return [bg, ...(selectedBorder ? [selectedBorder] : []), name, patience, status, want, hitArea];
  }

  private addSelectedBorder(rect: Rect): Phaser.GameObjects.Graphics {
    return this.add.graphics()
      .lineStyle(2, colors.accentPressed, 1)
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
      && this.state.activeCustomers.every((customer) => customer.status !== 'waiting')
      && this.state.activeCustomers.every((customer) => !this.isRecentlyServed(customer, nowMs));
  }

  private renderExcuseCounter(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.excuseCounter, colors.greenPanel, 14);
    const inner = inset(layout.excuseCounter, layout.compact ? 7 : 11);
    const heading = addLabel(this, 'Excuse Counter', inner.x, inner.y, layout.compact ? 13 : 16, '#2b2018');
    const cardGap = layout.compact ? 4 : 7;
    const cardTop = inner.y + (layout.compact ? 20 : 29);
    const cardHeight = Math.max(layout.compact ? 26 : 32, Math.floor((inner.height - (cardTop - inner.y) - cardGap * 2) / 3));
    const cards = starterExcuseIds.flatMap((id, index) => {
      const y = cardTop + index * (cardHeight + cardGap);
      return this.renderExcuseCard(
        { x: inner.x, y, width: inner.width, height: cardHeight },
        id,
        this.state.excuseStock[id],
        getExcuseStockCap(this.state, id),
        layout.compact,
      );
    });

    this.addToUi(panel, heading, ...cards);
  }

  private renderExcuseCard(rect: Rect, excuseId: ExcuseId, stock: number, maxStock: number, compact: boolean): Phaser.GameObjects.GameObject[] {
    const selectedWants = this.selectedCustomerWants(excuseId);
    const ready = selectedWants && stock > 0;
    const flashing = this.stockFlashExcuseId === excuseId;
    const bg = addPanel(this, rect, ready ? colors.panelServed : selectedWants ? colors.panelNeeded : colors.panel, 10);
    const border = selectedWants ? this.addCueBorder(rect, ready) : undefined;
    const label = compact ? excuses[excuseId].shortLabel : excuses[excuseId].displayName;
    const countPrefix = selectedWants ? ready ? 'พร้อม' : 'ต้องใช้' : 'Stock';
    const badgeWidth = compact ? 72 : 92;
    const title = addLabel(this, label, rect.x + 10, rect.y + (compact ? 5 : 8), compact ? 10 : 13, '#2b2018', rect.width - badgeWidth - 22);
    const countBadge = addPanel(
      this,
      {
        x: rect.x + rect.width - badgeWidth - 8,
        y: rect.y + (compact ? 4 : 6),
        width: badgeWidth,
        height: rect.height - (compact ? 8 : 12),
      },
      selectedWants ? colors.panel : colors.panelEmpty,
      9,
      { shadow: false },
    );
    const count = addLabel(
      this,
      compact ? `${stock}/${maxStock}` : `${countPrefix} ${stock}/${maxStock}`,
      rect.x + rect.width - badgeWidth - 2,
      rect.y + rect.height / 2 - (compact ? 7 : 8),
      compact ? 10 : 11,
      selectedWants ? '#2b2018' : '#74594c',
      badgeWidth - 12,
    );
    count.setFontStyle('700');
    const flashObjects = flashing ? this.renderStockFlash(rect, compact, this.stockFlashKind ?? 'consume') : [];
    return [bg, ...(border ? [border] : []), title, countBadge, count, ...flashObjects];
  }

  private renderStockFlash(rect: Rect, compact: boolean, kind: StockFlashKind): Phaser.GameObjects.GameObject[] {
    const positive = kind === 'craft';
    const flashColor = positive ? colors.readyBorder : colors.accentPressed;
    const glow = this.add.graphics()
      .lineStyle(4, flashColor, 1)
      .strokeRoundedRect(rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6, 10);
    const delta = addLabel(
      this,
      positive ? '+1' : '-1',
      rect.x + rect.width - (compact ? 42 : 48),
      rect.y + rect.height / 2 - (compact ? 9 : 11),
      compact ? 14 : 16,
      positive ? '#2f7d32' : '#d97706',
      36,
    );
    delta.setFontStyle('900');

    this.tweens.add({
      targets: [glow, delta],
      alpha: { from: 1, to: 0 },
      duration: stockFlashDurationMs,
      ease: 'Quad.easeOut',
    });
    this.tweens.add({
      targets: delta,
      y: delta.y - 8,
      duration: stockFlashDurationMs,
      ease: 'Quad.easeOut',
    });

    return [glow, delta];
  }

  private renderCraftPanel(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.craftPanel, colors.craftPanel, 14);
    const inner = inset(layout.craftPanel, layout.compact ? 6 : 11);
    const heading = addLabel(this, 'Craft Panel', inner.x, inner.y, layout.compact ? 13 : 16, '#2b2018');
    const buttonGap = layout.compact ? 4 : 7;
    const buttonTop = inner.y + (layout.compact ? 19 : 30);
    const buttonHeight = Math.max(layout.compact ? 30 : 36, Math.min(layout.compact ? 38 : 44, Math.floor((inner.height - (buttonTop - inner.y) - buttonGap * 2) / 3)));
    const selectedCustomer = this.getSelectedCustomer();
    const missingAllAcceptedStock = selectedCustomer !== undefined && !hasMatchingStock(this.state, selectedCustomer);
    const nowMs = Date.now();
    const buttons = starterExcuseIds.flatMap((id, index) => {
      const selectedWants = this.selectedCustomerWants(id);
      const stockMissing = selectedWants && missingAllAcceptedStock;
      const excuseLabel = layout.compact ? excuses[id].shortLabel : excuses[id].displayName;
      const stock = this.state.excuseStock[id];
      const cap = getExcuseStockCap(this.state, id);
      const activeCraft = this.state.activeCrafts[id];
      const remainingSeconds = activeCraft
        ? Math.max(1, Math.ceil((activeCraft.completesAtMs - nowMs) / 1000))
        : 0;
      const full = stock >= cap;
      const label = activeCraft
        ? `กำลังผลิต... ${remainingSeconds}s`
        : full
          ? layout.compact ? `เต็ม ${stock}/${cap}` : `เต็มแล้ว ${stock}/${cap}`
          : stockMissing
            ? `ผลิต ${excuseLabel} · ควรผลิต`
            : `ผลิต ${excuseLabel}`;
      const y = buttonTop + index * (buttonHeight + buttonGap);
      const buttonRect = { x: inner.x, y, width: inner.width, height: buttonHeight };
      const button = addButton(
        this,
        buttonRect,
        label,
        () => this.handleCraft(id),
        {
          fontSize: activeCraft || full || stockMissing ? layout.compact ? 10 : 12 : layout.compact ? 11 : 14,
          fillColor: activeCraft ? colors.panelNeeded : full ? colors.panelEmpty : stockMissing ? colors.panelNeeded : undefined,
          pressedColor: activeCraft || full ? colors.panelEmpty : stockMissing ? colors.accent : undefined,
        },
      );
      const progressBar = activeCraft
        ? this.renderCraftProgressBar(buttonRect, activeCraft.startedAtMs, activeCraft.completesAtMs, nowMs, layout.compact)
        : [];
      return [...button.group.getChildren(), ...progressBar];
    });

    this.addToUi(panel, heading, ...buttons);
  }

  private renderCraftProgressBar(
    rect: Rect,
    startedAtMs: number,
    completesAtMs: number,
    nowMs: number,
    compact: boolean,
  ): Phaser.GameObjects.GameObject[] {
    const durationMs = Math.max(1, completesAtMs - startedAtMs);
    const elapsedMs = Math.max(0, nowMs - startedAtMs);
    const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
    const barInset = compact ? 12 : 14;
    const barHeight = compact ? 4 : 5;
    const barRect = {
      x: rect.x + barInset,
      y: rect.y + rect.height - (compact ? 8 : 9),
      width: rect.width - barInset * 2,
      height: barHeight,
    };
    const fillWidth = Math.max(0, Math.floor(barRect.width * progress));
    const track = this.add.graphics()
      .fillStyle(colors.progressTrack, 1)
      .lineStyle(1, colors.borderSoft, 1)
      .fillRoundedRect(barRect.x, barRect.y, barRect.width, barRect.height, barHeight)
      .strokeRoundedRect(barRect.x, barRect.y, barRect.width, barRect.height, barHeight);
    const fill = this.add.graphics()
      .fillStyle(colors.progressFill, 1)
      .fillRoundedRect(barRect.x, barRect.y, fillWidth, barRect.height, barHeight);

    return [track, fill];
  }

  private renderFooter(layout: FactoryLayout): void {
    const panel = addPanel(this, layout.footer, colors.footer, 14);
    const inner = inset(layout.footer, layout.compact ? 5 : 7);
    const labels = ['Upgrades', 'Zones', 'Archive', 'Settings'];
    const gap = 6;
    const width = (inner.width - gap * (labels.length - 1)) / labels.length;
    const buttons = labels.map((label, index) => {
      let onPress = (): void => this.showToast(`${label} panel coming soon`);
      if (label === 'Upgrades') {
        onPress = () => this.openUpgradesModal();
      }

      if (label === 'Zones') {
        onPress = () => this.openZonesModal();
      }

      if (label === 'Archive') {
        onPress = () => this.openArchiveModal();
      }

      if (label === 'Settings') {
        onPress = () => this.openSettingsModal();
      }

      return addButton(
        this,
        {
          x: inner.x + index * (width + gap),
          y: inner.y,
          width,
          height: inner.height,
        },
        label,
        onPress,
        {
          fontSize: layout.compact ? 10 : 11,
          fillColor: colors.footerButton,
          pressedColor: colors.accent,
        },
      );
    });

    this.addToUi(panel, ...buttons.flatMap((button) => button.group.getChildren()));
  }

  private openSettingsModal(): void {
    this.activeModal = 'settings';
    this.renderActiveModal();
  }

  private openUpgradesModal(): void {
    this.resetSaveArmed = false;
    this.activeModal = 'upgrades';
    this.renderActiveModal();
  }

  private openZonesModal(): void {
    this.resetSaveArmed = false;
    this.activeModal = 'zones';
    this.renderActiveModal();
  }

  private openArchiveModal(): void {
    this.resetSaveArmed = false;
    this.activeModal = 'archive';
    this.renderActiveModal();
  }

  private openOfflineEarningsModal(earnings: OfflineEarningsResult): void {
    this.resetSaveArmed = false;
    this.offlineEarnings = earnings;
    this.activeModal = 'offlineEarnings';
    this.renderActiveModal();
  }

  private closeModal(): void {
    if (this.activeModal === 'offlineEarnings') {
      this.offlineEarnings = undefined;
    }

    this.activeModal = undefined;
    this.resetSaveArmed = false;
    this.modalPanel?.destroy();
    this.modalPanel = undefined;
  }

  private renderActiveModal(): void {
    this.modalPanel?.destroy();
    this.modalPanel = undefined;

    if (this.activeModal === 'settings') {
      this.renderSettingsModal();
    }

    if (this.activeModal === 'upgrades') {
      this.renderUpgradesModal();
    }

    if (this.activeModal === 'zones') {
      this.renderZonesModal();
    }

    if (this.activeModal === 'archive') {
      this.renderArchiveModal();
    }

    if (this.activeModal === 'offlineEarnings') {
      this.renderOfflineEarningsModal();
    }
  }

  private renderOfflineEarningsModal(): void {
    const earnings = this.offlineEarnings;
    if (!earnings) {
      return;
    }

    const height = this.scale.height;
    const compact = height < 720;
    const modal = createModalPanel(this, {
      depth: modalDepth,
      onClose: () => this.closeModal(),
      subtitle: 'ขายข้ออ้างได้ระหว่างพัก',
      title: 'โรงงานทำงานตอนคุณไม่อยู่!',
    });
    this.modalPanel = modal;

    const rowX = modal.contentRect.x;
    const rowWidth = modal.contentRect.width;
    const topY = modal.contentRect.y;
    const body = addLabel(
      this,
      'ขายข้ออ้างได้ระหว่างพัก',
      rowX,
      topY,
      compact ? 12 : 14,
      '#74594c',
      rowWidth,
    );
    const reward = addLabel(
      this,
      `ได้รับ +${earnings.coins} coins`,
      rowX,
      topY + (compact ? 42 : 50),
      compact ? 22 : 26,
      '#2b2018',
      rowWidth,
    );
    const time = addLabel(
      this,
      `เวลาออฟไลน์ที่นับ: ${this.formatOfflineMinutes(earnings.cappedSeconds)}m`,
      rowX,
      topY + (compact ? 88 : 106),
      compact ? 11 : 13,
      '#74594c',
      rowWidth,
    );
    const capped = earnings.totalAwaySeconds > earnings.cappedSeconds
      ? addLabel(
        this,
        'นับสูงสุด 120m สำหรับ MVP',
        rowX,
        topY + (compact ? 110 : 130),
        compact ? 9 : 11,
        '#74594c',
        rowWidth,
      )
      : undefined;
    const buttonHeight = compact ? 38 : 44;
    const button = addButton(
      this,
      {
        x: rowX,
        y: modal.panelRect.y + modal.panelRect.height - buttonHeight - (compact ? 22 : 28),
        width: rowWidth,
        height: buttonHeight,
      },
      'รับทรัพย์',
      () => this.closeModal(),
      {
        fontSize: compact ? 13 : 15,
        fillColor: colors.accent,
        pressedColor: colors.accentPressed,
      },
    );

    body.setFontStyle('700');
    reward.setFontStyle('900');
    time.setFontStyle('800');
    capped?.setFontStyle('700');

    modal.addContent(
      body,
      reward,
      time,
      ...(capped ? [capped] : []),
      ...button.group.getChildren(),
    );
  }

  private renderSettingsModal(): void {
    const height = this.scale.height;
    const compact = height < 720;
    const showDevQa = devQaEnabled;
    const modal = createModalPanel(this, {
      depth: modalDepth,
      onClose: () => this.closeModal(),
      subtitle: 'ตั้งค่า',
      title: 'Settings',
    });
    this.modalPanel = modal;

    const rows = ['Sound: On', 'Music: On', 'Save: Auto'];
    const rowGap = showDevQa ? compact ? 4 : 6 : compact ? 8 : 10;
    const rowHeight = showDevQa ? compact ? 27 : 32 : compact ? 38 : 44;
    const rowX = modal.contentRect.x;
    const rowWidth = modal.contentRect.width;
    const rowStartY = modal.contentRect.y;
    const rowObjects = rows.flatMap((row, index) => {
      const y = rowStartY + index * (rowHeight + rowGap);
      const rowPanel = addPanel(this, { x: rowX, y, width: rowWidth, height: rowHeight }, colors.panel, 12);
      const rowLabel = addLabel(this, row, rowX + 14, y + rowHeight / 2 - (showDevQa ? 6 : 8), showDevQa ? compact ? 9 : 11 : compact ? 12 : 14, '#2b2018', rowWidth - 28);
      rowLabel.setFontStyle('700');
      return [rowPanel, rowLabel];
    });
    const resetY = rowStartY + rows.length * (rowHeight + rowGap);
    const resetHeight = showDevQa ? compact ? 38 : 44 : compact ? 54 : 60;
    const resetPanel = addPanel(
      this,
      { x: rowX, y: resetY, width: rowWidth, height: resetHeight },
      this.resetSaveArmed ? colors.panelNeeded : colors.panelEmpty,
      12,
    );
    const resetTitle = addLabel(
      this,
      this.resetSaveArmed ? 'กดอีกครั้งเพื่อยืนยัน' : 'Reset Save',
      rowX + 14,
      resetY + (showDevQa ? compact ? 6 : 7 : compact ? 9 : 10),
      showDevQa ? compact ? 10 : 11 : compact ? 12 : 14,
      '#2b2018',
      rowWidth - 28,
    );
    const resetHelp = addLabel(
      this,
      'ล้างเซฟแล้วเริ่มใหม่',
      rowX + 14,
      resetY + (showDevQa ? compact ? 23 : 25 : compact ? 31 : 35),
      showDevQa ? compact ? 7 : 8 : compact ? 9 : 10,
      '#74594c',
      rowWidth - 28,
    );
    const resetHitArea = this.add.zone(rowX, resetY, rowWidth, resetHeight)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    resetHitArea.on('pointerup', () => this.handleResetSave());
    resetTitle.setFontStyle('800');
    resetHelp.setFontStyle('700');

    const noteY = modal.panelRect.y + modal.panelRect.height - (compact ? 34 : 40);
    const devTopY = resetY + resetHeight + rowGap;
    const devObjects = showDevQa
      ? this.renderDevQaSeedControls(
        {
          x: rowX,
          y: devTopY,
          width: rowWidth,
          height: Math.max(0, noteY - devTopY - (compact ? 8 : 10)),
        },
        compact,
      )
      : [];
    const note = addLabel(
      this,
      showDevQa ? 'Dev only: writes save and reloads scene' : 'Placeholder only',
      rowX,
      noteY,
      showDevQa ? compact ? 7 : 8 : compact ? 10 : 11,
      '#74594c',
      rowWidth,
    );
    note.setFontStyle('700');

    modal.addContent(...rowObjects, resetPanel, resetTitle, resetHelp, resetHitArea, ...devObjects, note);
  }

  private renderDevQaSeedControls(rect: Rect, compact: boolean): Phaser.GameObjects.GameObject[] {
    const title = addLabel(this, 'Dev QA Seeds', rect.x, rect.y, compact ? 9 : 10, '#2b2018', rect.width);
    title.setFontStyle('900');

    const gap = compact ? 4 : 5;
    const buttonTop = rect.y + (compact ? 15 : 17);
    const buttonHeight = compact ? 22 : 24;
    const columns = 2;
    const buttonWidth = (rect.width - gap) / columns;
    const buttons = devSaveSeedDefinitions.flatMap((seed, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const button = addButton(
        this,
        {
          x: rect.x + column * (buttonWidth + gap),
          y: buttonTop + row * (buttonHeight + gap),
          width: buttonWidth,
          height: buttonHeight,
        },
        seed.label,
        () => this.handleDevSaveSeed(seed),
        {
          fontSize: compact ? 7 : 8,
          fillColor: colors.panelNeeded,
          pressedColor: colors.accent,
        },
      );
      return button.group.getChildren();
    });

    return [title, ...buttons];
  }

  private renderUpgradesModal(): void {
    const height = this.scale.height;
    const compact = height < 720;
    const modal = createModalPanel(this, {
      depth: modalDepth,
      onClose: () => this.closeModal(),
      subtitle: 'อัปเกรดโรงงานข้ออ้าง',
      title: 'Upgrades',
    });
    this.modalPanel = modal;

    const visibleUpgrades = upgrades;
    const rowGap = compact ? 6 : 8;
    const rowHeight = compact ? 52 : 58;
    const rowX = modal.contentRect.x;
    const rowWidth = modal.contentRect.width;
    const rowStartY = modal.contentRect.y;
    const buttonWidth = compact ? 64 : 74;
    const contentWidth = rowWidth - buttonWidth - 24;
    const rowObjects = visibleUpgrades.flatMap((upgrade, index) => {
      const y = rowStartY + index * (rowHeight + rowGap);
      const level = getUpgradeLevel(this.state, upgrade.id);
      const maxed = level >= upgrade.maxLevel;
      const costValue = calculateUpgradeCost(upgrade, level);
      const affordable = this.state.currencies.coins >= costValue;
      const rowPanel = addPanel(this, { x: rowX, y, width: rowWidth, height: rowHeight }, colors.panel, 12);
      const name = addLabel(this, upgrade.displayName, rowX + 10, y + (compact ? 5 : 6), compact ? 10 : 12, '#2b2018', contentWidth);
      const description = addLabel(
        this,
        `${upgrade.description} · ${upgrade.effectLabel ?? ''}`,
        rowX + 10,
        y + (compact ? 20 : 24),
        compact ? 7 : 8,
        '#74594c',
        contentWidth,
      );
      const cost = addLabel(
        this,
        upgrade.implemented
          ? maxed ? `Lv ${level}/${upgrade.maxLevel} · Max` : `Lv ${level}/${upgrade.maxLevel} · Cost ${costValue} coins`
          : 'Soon · waits for timers',
        rowX + 10,
        y + rowHeight - (compact ? 14 : 16),
        compact ? 7 : 8,
        '#2b2018',
        contentWidth,
      );
      const action = this.renderUpgradeAction(
        upgrade,
        {
          x: rowX + rowWidth - buttonWidth - 10,
          y: y + rowHeight / 2 - (compact ? 13 : 15),
          width: buttonWidth,
          height: compact ? 26 : 30,
        },
        compact,
        affordable,
        maxed,
      );
      name.setFontStyle('800');
      description.setFontStyle('600');
      cost.setFontStyle('800');
      return [rowPanel, name, description, cost, ...action];
    });

    const note = addLabel(
      this,
      'Offline earnings stay on the MVP flat formula',
      rowX,
      modal.panelRect.y + modal.panelRect.height - (compact ? 34 : 40),
      compact ? 9 : 11,
      '#74594c',
      rowWidth,
    );
    note.setFontStyle('700');

    modal.addContent(...rowObjects, note);
  }

  private renderUpgradeAction(
    upgrade: UpgradeDefinition,
    rect: Rect,
    compact: boolean,
    affordable: boolean,
    maxed: boolean,
  ): Phaser.GameObjects.GameObject[] {
    if (!upgrade.implemented || maxed) {
      const panel = addPanel(this, rect, colors.panelEmpty, 10);
      const label = addLabel(
        this,
        maxed ? 'Max' : 'Soon',
        rect.x + rect.width / 2,
        rect.y + rect.height / 2 - (compact ? 6 : 7),
        compact ? 9 : 10,
        '#74594c',
        rect.width,
      );
      label.setOrigin(0.5, 0);
      label.setFontStyle('800');
      return [panel, label];
    }

    const button = addButton(
      this,
      rect,
      affordable ? 'Buy' : 'No coins',
      () => this.handleBuyUpgrade(upgrade.id),
      {
        fontSize: compact ? 8 : 9,
        fillColor: affordable ? colors.accent : colors.panelNeeded,
        pressedColor: affordable ? colors.accentPressed : colors.panelEmpty,
      },
    );
    return button.group.getChildren();
  }

  private renderZonesModal(): void {
    const height = this.scale.height;
    const compact = height < 720;
    const modal = createModalPanel(this, {
      depth: modalDepth,
      onClose: () => this.closeModal(),
      subtitle: 'โซนปัญหาชีวิต',
      title: 'Zones',
    });
    this.modalPanel = modal;

    const visibleZones = zones.slice(0, 3);
    const rowGap = compact ? 8 : 11;
    const rowHeight = compact ? 78 : 88;
    const rowX = modal.contentRect.x;
    const rowWidth = modal.contentRect.width;
    const rowStartY = modal.contentRect.y;
    const buttonWidth = compact ? 62 : 76;
    const contentWidth = rowWidth - buttonWidth - 28;
    const rowObjects = visibleZones.flatMap((zone, index) => {
      const y = rowStartY + index * (rowHeight + rowGap);
      const current = zone.id === this.state.currentZoneId;
      const unlocked = zone.unlockedByDefault || this.state.unlockedZoneIds.includes(zone.id);
      const status = current ? 'Current' : unlocked ? 'Unlocked' : 'Locked';
      const actionLabel = current ? 'Current' : compact ? 'Soon' : 'ยังไม่เปิด';
      const rowPanel = addPanel(this, { x: rowX, y, width: rowWidth, height: rowHeight }, current ? colors.panelServed : colors.panel, 12);
      const name = addLabel(this, zone.displayName, rowX + 12, y + 8, compact ? 12 : 14, '#2b2018', contentWidth);
      const description = addLabel(this, zone.description, rowX + 12, y + (compact ? 29 : 32), compact ? 8 : 10, '#74594c', contentWidth);
      const requirement = addLabel(
        this,
        zone.unlockRequirementText ?? (current ? 'Starter zone' : 'Unlock requirement not added yet'),
        rowX + 12,
        y + rowHeight - (compact ? 18 : 21),
        compact ? 8 : 10,
        '#2b2018',
        contentWidth,
      );
      const actionRect = {
        x: rowX + rowWidth - buttonWidth - 10,
        y: y + rowHeight / 2 - (compact ? 14 : 16),
        width: buttonWidth,
        height: compact ? 28 : 32,
      };
      const actionButton = addPanel(this, actionRect, current ? colors.panelServed : colors.panelEmpty, 10);
      const action = addLabel(
        this,
        actionLabel,
        actionRect.x + actionRect.width / 2,
        actionRect.y + actionRect.height / 2 - (compact ? 6 : 7),
        compact ? 8 : 10,
        '#74594c',
        actionRect.width,
      );
      const statusLabel = addLabel(
        this,
        status,
        rowX + rowWidth - buttonWidth - 10,
        y + 8,
        compact ? 8 : 9,
        current ? '#2f7d32' : '#74594c',
        buttonWidth,
      );
      name.setFontStyle('800');
      description.setFontStyle('600');
      requirement.setFontStyle('800');
      action.setOrigin(0.5, 0);
      action.setFontStyle('800');
      statusLabel.setFontStyle('900');
      return [rowPanel, name, description, requirement, actionButton, action, statusLabel];
    });

    const note = addLabel(
      this,
      'Zone switching is not added yet',
      rowX,
      modal.panelRect.y + modal.panelRect.height - (compact ? 34 : 40),
      compact ? 9 : 11,
      '#74594c',
      rowWidth,
    );
    note.setFontStyle('700');

    modal.addContent(...rowObjects, note);
  }

  private renderArchiveModal(): void {
    const height = this.scale.height;
    const compact = height < 720;
    const modal = createModalPanel(this, {
      depth: modalDepth,
      onClose: () => this.closeModal(),
      subtitle: 'คลังข้ออ้างและลูกค้า',
      title: 'Archive',
    });
    this.modalPanel = modal;

    const rowX = modal.contentRect.x;
    const rowWidth = modal.contentRect.width;
    const topY = modal.contentRect.y;
    const progressHeight = compact ? 44 : 50;
    const progressPanel = addPanel(this, { x: rowX, y: topY, width: rowWidth, height: progressHeight }, colors.panel, 12);
    const excuseProgress = addLabel(
      this,
      `Excuses discovered: ${starterExcuseIds.length} / ?`,
      rowX + 12,
      topY + (compact ? 7 : 8),
      compact ? 10 : 12,
      '#2b2018',
      rowWidth - 24,
    );
    const customerProgress = addLabel(
      this,
      `Customers discovered: ${customers.length} / ?`,
      rowX + 12,
      topY + (compact ? 24 : 28),
      compact ? 10 : 12,
      '#2b2018',
      rowWidth - 24,
    );
    excuseProgress.setFontStyle('800');
    customerProgress.setFontStyle('800');

    const sectionGap = compact ? 8 : 10;
    const sectionY = topY + progressHeight + sectionGap;
    const sectionWidth = (rowWidth - sectionGap) / 2;
    const sectionHeight = compact ? 136 : 152;
    const excuseItems = starterExcuseIds.map((id) => excuses[id].displayName);
    const customerItems = customers.slice(0, 3).map((customer) => customer.displayName);
    const excuseSection = this.renderArchiveSection(
      { x: rowX, y: sectionY, width: sectionWidth, height: sectionHeight },
      compact ? 'Excuses' : 'Starter excuses',
      excuseItems,
      compact,
    );
    const customerSection = this.renderArchiveSection(
      { x: rowX + sectionWidth + sectionGap, y: sectionY, width: sectionWidth, height: sectionHeight },
      compact ? 'Customers' : 'Starter customers',
      customerItems,
      compact,
    );

    const note = addLabel(
      this,
      compact ? 'ระบบสะสมจะเพิ่มภายหลัง' : 'ระบบสะสมจะเพิ่มภายหลัง · Soon',
      rowX,
      modal.panelRect.y + modal.panelRect.height - (compact ? 34 : 40),
      compact ? 9 : 11,
      '#74594c',
      rowWidth,
    );
    note.setFontStyle('800');

    modal.addContent(progressPanel, excuseProgress, customerProgress, ...excuseSection, ...customerSection, note);
  }

  private renderArchiveSection(rect: Rect, title: string, items: string[], compact: boolean): Phaser.GameObjects.GameObject[] {
    const sectionPanel = addPanel(this, rect, colors.panel, 12);
    const titleLabel = addLabel(this, title, rect.x + 8, rect.y + 7, compact ? 10 : 12, '#2b2018', rect.width - 16);
    titleLabel.setFontStyle('900');

    const rowGap = compact ? 5 : 6;
    const rowHeight = compact ? 28 : 31;
    const rowStartY = rect.y + (compact ? 27 : 32);
    const rows = items.flatMap((item, index) => {
      const y = rowStartY + index * (rowHeight + rowGap);
      const rowPanel = addPanel(this, { x: rect.x + 7, y, width: rect.width - 14, height: rowHeight }, colors.greenPanel, 9);
      const name = addLabel(this, item, rect.x + 14, y + (compact ? 5 : 6), compact ? 8 : 9, '#2b2018', rect.width - 56);
      const badge = addLabel(
        this,
        'Seen',
        rect.x + rect.width - 51,
        y + (compact ? 6 : 7),
        compact ? 7 : 8,
        '#2f7d32',
        44,
      );
      name.setFontStyle('800');
      badge.setFontStyle('900');
      return [rowPanel, name, badge];
    });

    return [sectionPanel, titleLabel, ...rows];
  }

  private applyOfflineEarningsOnLoad(loadResult: LoadSaveResult, nowMs: number): OfflineEarningsResult | undefined {
    if (loadResult.status !== 'loaded') {
      return undefined;
    }

    const earnings = calculateOfflineEarnings(loadResult.lastActiveAtMs, nowMs);
    if (!earnings) {
      return undefined;
    }

    this.state.currencies.coins = this.sanitizeCurrency(this.state.currencies.coins + earnings.coins);
    this.state.lastUpdatedAtMs = nowMs;
    saveGameState(this.state, nowMs);
    return earnings;
  }

  private handleResetSave(): void {
    if (!this.resetSaveArmed) {
      this.resetSaveArmed = true;
      this.renderActiveModal();
      this.showToast('กดอีกครั้งเพื่อยืนยัน');
      return;
    }

    clearSavedGame();
    this.state = createInitialState();
    this.selectedCustomerInstanceId = undefined;
    this.stockFlashTimer?.remove();
    this.stockFlashExcuseId = undefined;
    this.stockFlashKind = undefined;
    this.servedFeedbackTimer?.remove();
    this.resetSaveArmed = false;
    this.renderFactory();
    this.showToast('ล้างเซฟแล้วเริ่มใหม่');
  }

  private handleDevSaveSeed(seed: DevSaveSeedDefinition): void {
    if (!devQaEnabled) {
      return;
    }

    const nowMs = Date.now();
    if (!writeDevSaveSeed(seed.id, nowMs)) {
      this.showToast('Dev seed failed: localStorage unavailable');
      return;
    }

    const loadResult = loadGameState(nowMs);
    this.state = loadResult.state;
    this.selectedCustomerInstanceId = undefined;
    this.stockFlashTimer?.remove();
    this.stockFlashExcuseId = undefined;
    this.stockFlashKind = undefined;
    this.servedFeedbackTimer?.remove();
    this.resetSaveArmed = false;
    this.offlineEarnings = undefined;
    this.activeModal = undefined;
    this.lastPatienceRenderSecond = -1;
    this.renderFactory();
    this.showToast(`Dev seed: ${seed.label}`);
  }

  private saveProgress(): void {
    saveGameState(this.state);
  }

  private handleBuyUpgrade(upgradeId: string): void {
    const result = purchaseUpgrade(this.state, upgradeId);

    if (!result.purchased) {
      if (result.reason === 'not_enough_coins') {
        this.showToast('coins ไม่พอ');
        return;
      }

      if (result.reason === 'max_level') {
        this.showToast('อัปเกรดเต็มแล้ว');
        return;
      }

      this.showToast('อัปเกรดนี้ยังไม่เปิด');
      return;
    }

    this.saveProgress();
    this.renderFactory();
    this.showToast(`${result.upgrade?.displayName ?? 'Upgrade'} Lv ${result.nextLevel}`);
  }

  private formatOfflineMinutes(seconds: number): number {
    return Math.max(1, Math.ceil(this.sanitizeCurrency(seconds) / 60));
  }

  private sanitizeCurrency(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private handleCraft(excuseId: ExcuseId): void {
    const result = craftExcuse(this.state, excuseId);
    const excuse = excuses[excuseId];

    if (!result.started) {
      this.renderFactory();
      this.showToast(result.reason === 'already_crafting' ? 'กำลังผลิตอยู่' : 'ข้ออ้างเต็มแล้ว!');
      return;
    }

    this.saveProgress();
    this.renderFactory();
    this.showToast(`เริ่มผลิต ${excuse.displayName} ${Math.ceil((result.durationMs ?? 0) / 1000)}s`);
  }

  private handleNextBatch(): void {
    const patienceResult = expireCustomerPatience(this.state);
    if (patienceResult.expiredInstanceIds.length > 0) {
      this.saveProgress();
    }

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

    this.saveProgress();
    this.showToast('เรียกลูกค้าชุดต่อไปแล้ว');
  }

  private handleServeSelected(): void {
    if (!this.selectedCustomerInstanceId) {
      this.showToast('เลือกลูกค้าก่อน');
      return;
    }

    const patienceResult = expireCustomerPatience(this.state);
    if (patienceResult.expiredInstanceIds.length > 0) {
      this.saveProgress();
    }

    if (patienceResult.expiredInstanceIds.includes(this.selectedCustomerInstanceId)) {
      this.selectedCustomerInstanceId = undefined;
      this.renderFactory();
      this.showToast('ลูกค้ารอไม่ไหวแล้ว...');
      return;
    }

    const result = serveCustomerByInstanceId(this.state, this.selectedCustomerInstanceId);
    if (!result.served) {
      this.clearInvalidSelection();
      this.renderFactory();
      this.showToast('ยังไม่มีข้ออ้างที่ลูกค้าต้องการ');
      return;
    }

    const servedCustomer = this.state.activeCustomers.find((customer) => {
      return customer.instanceId === this.selectedCustomerInstanceId;
    });
    const consumedExcuseId = servedCustomer?.servedReward?.consumedExcuseId ?? result.excuseId;
    if (consumedExcuseId) {
      this.scheduleStockFlash(consumedExcuseId, 'consume');
    }
    this.selectedCustomerInstanceId = undefined;
    this.saveProgress();
    this.renderFactory();
    this.scheduleServedFeedbackRefresh();
    this.showToast(`ขายข้ออ้างสำเร็จ +${result.coinsGained} coins`);
  }

  private selectCustomer(instanceId: string): void {
    const patienceResult = expireCustomerPatience(this.state);
    if (patienceResult.expiredInstanceIds.length > 0) {
      this.saveProgress();
      this.renderFactory();
    }

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

  private hasActiveCrafts(): boolean {
    return starterExcuseIds.some((excuseId) => this.state.activeCrafts[excuseId] !== undefined);
  }

  private formatWantedExcuseNames(excuseIds: ExcuseId[]): string {
    return excuseIds.map((excuseId) => excuses[excuseId].displayName).join(' / ');
  }

  private getServeStatusText(): string {
    const selected = this.getSelectedCustomer();
    if (!selected) {
      return 'เลือกลูกค้าก่อน';
    }

    return hasMatchingStock(this.state, selected) ? 'พร้อมเสิร์ฟ' : 'ต้องผลิตก่อน';
  }

  private getCustomerArrivalHintText(nowMs: number): string | undefined {
    if (!hasCustomerArrivalRoom(this.state)) {
      return undefined;
    }

    const remainingMs = getNextCustomerArrivalRemainingMs(this.state, nowMs);
    if (remainingMs <= 0) {
      return 'ลูกค้าคนต่อไป: soon';
    }

    return `ลูกค้าคนต่อไป: ${Math.ceil(remainingMs / 1000)}s`;
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

  private scheduleStockFlash(excuseId: ExcuseId, kind: StockFlashKind): void {
    this.stockFlashTimer?.remove();
    this.stockFlashExcuseId = excuseId;
    this.stockFlashKind = kind;
    this.stockFlashTimer = this.time.delayedCall(stockFlashDurationMs, () => {
      this.stockFlashExcuseId = undefined;
      this.stockFlashKind = undefined;
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
