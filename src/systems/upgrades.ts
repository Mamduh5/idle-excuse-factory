import { upgrades } from '../data/upgrades';
import { excuses } from '../data/excuses';
import type { ExcuseId, GameState, UpgradeDefinition } from '../types/game';

export const stockCapUpgradeId = 'bigger_shelf';
export const coinRewardUpgradeId = 'premium_bullshit';
export const smoothnessRewardUpgradeId = 'smoother_words';
export const printerSpeedUpgradeId = 'extra_printer';

const stockCapBonusPerLevel = 2;
const coinRewardBonusPerLevel = 0.1;
const smoothnessBonusPerLevel = 1;
const printerSpeedBonusPerLevel = 0.1;
const minCraftDurationMs = 500;
const defaultCostGrowth = 1.45;

export type UpgradePurchaseResult = {
  cost: number;
  level: number;
  maxLevel: number;
  nextLevel: number;
  purchased: boolean;
  reason?: 'unavailable' | 'max_level' | 'not_enough_coins';
  upgrade?: UpgradeDefinition;
};

const upgradeById = new Map(upgrades.map((upgrade) => [upgrade.id, upgrade]));

export function getUpgradeById(upgradeId: string): UpgradeDefinition | undefined {
  return upgradeById.get(upgradeId);
}

export function getUpgradeLevel(state: GameState, upgradeId: string): number {
  const upgrade = getUpgradeById(upgradeId);
  const rawLevel = state.upgrades[upgradeId];
  const level = sanitizeCount(rawLevel);
  return upgrade ? Math.min(level, sanitizeCount(upgrade.maxLevel)) : level;
}

export function calculateUpgradeCost(upgrade: UpgradeDefinition, currentLevel: number): number {
  const baseCost = Math.max(1, sanitizeCount(upgrade.costCoins));
  const growth = Number.isFinite(upgrade.costGrowth) && upgrade.costGrowth !== undefined && upgrade.costGrowth > 1
    ? upgrade.costGrowth
    : defaultCostGrowth;
  const scaledCost = Math.floor(baseCost * growth ** sanitizeCount(currentLevel));
  return Number.isFinite(scaledCost) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, scaledCost)) : Number.MAX_SAFE_INTEGER;
}

export function purchaseUpgrade(state: GameState, upgradeId: string, nowMs = Date.now()): UpgradePurchaseResult {
  const upgrade = getUpgradeById(upgradeId);
  if (!upgrade || !upgrade.implemented) {
    return emptyPurchaseResult(upgrade, 'unavailable');
  }

  const level = getUpgradeLevel(state, upgradeId);
  const maxLevel = sanitizeCount(upgrade.maxLevel);
  const cost = calculateUpgradeCost(upgrade, level);

  if (level >= maxLevel) {
    return {
      cost,
      level,
      maxLevel,
      nextLevel: level,
      purchased: false,
      reason: 'max_level',
      upgrade,
    };
  }

  const coins = sanitizeCount(state.currencies.coins);
  if (coins < cost) {
    state.currencies.coins = coins;
    return {
      cost,
      level,
      maxLevel,
      nextLevel: level,
      purchased: false,
      reason: 'not_enough_coins',
      upgrade,
    };
  }

  const nextLevel = Math.min(maxLevel, level + 1);
  state.currencies.coins = sanitizeCount(coins - cost);
  state.upgrades[upgradeId] = nextLevel;
  state.currencies.smoothness = sanitizeCount(state.currencies.smoothness);
  state.lastUpdatedAtMs = nowMs;

  return {
    cost,
    level,
    maxLevel,
    nextLevel,
    purchased: true,
    upgrade,
  };
}

export function getExcuseStockCap(state: GameState, excuseId: ExcuseId): number {
  const shelfLevel = getUpgradeLevel(state, stockCapUpgradeId);
  return getExcuseStockCapForLevel(excuseId, shelfLevel);
}

export function getExcuseStockCapForLevel(excuseId: ExcuseId, shelfLevel: number): number {
  const baseCap = sanitizeCount(excuses[excuseId].maxStock);
  return sanitizeCount(baseCap + sanitizeCount(shelfLevel) * stockCapBonusPerLevel);
}

export function calculateServeCoins(state: GameState, baseCoins: number): number {
  const premiumLevel = getUpgradeLevel(state, coinRewardUpgradeId);
  const multiplier = 1 + premiumLevel * coinRewardBonusPerLevel;
  return sanitizeCount(Math.floor(sanitizeCount(baseCoins) * multiplier));
}

export function calculateServeSmoothness(state: GameState, baseSmoothness: number): number {
  const smoothLevel = getUpgradeLevel(state, smoothnessRewardUpgradeId);
  return sanitizeCount(sanitizeCount(baseSmoothness) + smoothLevel * smoothnessBonusPerLevel);
}

export function calculateCraftDurationMs(state: GameState, excuseId: ExcuseId): number {
  const baseSeconds = excuses[excuseId].craftSeconds;
  const baseMs = Math.max(minCraftDurationMs, sanitizePositiveNumber(baseSeconds, 1) * 1000);
  const printerLevel = getUpgradeLevel(state, printerSpeedUpgradeId);
  const speedMultiplier = 1 + printerLevel * printerSpeedBonusPerLevel;
  const duration = Math.ceil(baseMs / speedMultiplier);
  return Math.max(minCraftDurationMs, sanitizeCount(duration));
}

function emptyPurchaseResult(upgrade: UpgradeDefinition | undefined, reason: UpgradePurchaseResult['reason']): UpgradePurchaseResult {
  const maxLevel = upgrade ? sanitizeCount(upgrade.maxLevel) : 0;
  return {
    cost: upgrade ? calculateUpgradeCost(upgrade, 0) : 0,
    level: 0,
    maxLevel,
    nextLevel: 0,
    purchased: false,
    reason,
    upgrade,
  };
}

function sanitizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sanitizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
