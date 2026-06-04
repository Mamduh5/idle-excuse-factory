import { customers } from '../data/customers';
import { starterExcuseIds } from '../data/excuses';
import { upgrades } from '../data/upgrades';
import { zones } from '../data/zones';
import { createInitialState } from '../state/initialState';
import { getCustomerPatienceMs } from '../systems/gameplay';
import { getExcuseStockCapForLevel, stockCapUpgradeId } from '../systems/upgrades';
import type {
  CustomerInstance,
  ExcuseId,
  ExcuseStock,
  GameState,
  SaveDataV1,
  UpgradeState,
} from '../types/game';

export const saveStorageKey = 'idle-excuse-factory-save-v1';

export type LoadSaveResult = {
  lastActiveAtMs?: number;
  state: GameState;
  status: 'loaded' | 'new' | 'error';
};

const knownExcuseIds = new Set<ExcuseId>(starterExcuseIds);
const customerById = new Map(customers.map((customer) => [customer.id, customer]));
const zoneIds = new Set(zones.map((zone) => zone.id));
const defaultZoneIds = zones.filter((zone) => zone.unlockedByDefault).map((zone) => zone.id);

export function loadGameState(nowMs = Date.now()): LoadSaveResult {
  const storage = getStorage();
  if (!storage) {
    return { state: createInitialState(nowMs), status: 'new' };
  }

  const rawSave = storage.getItem(saveStorageKey);
  if (!rawSave) {
    return { state: createInitialState(nowMs), status: 'new' };
  }

  try {
    const parsed = JSON.parse(rawSave) as unknown;
    if (!isSaveDataV1Like(parsed)) {
      return { state: createInitialState(nowMs), status: 'error' };
    }

    return {
      lastActiveAtMs: sanitizeOptionalTimestamp(parsed.lastActiveAtMs),
      state: normalizeSavedGame(parsed, nowMs),
      status: 'loaded',
    };
  } catch {
    return { state: createInitialState(nowMs), status: 'error' };
  }
}

export function saveGameState(state: GameState, nowMs = Date.now()): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  const saveData: SaveDataV1 = {
    version: 1,
    savedAtMs: nowMs,
    lastActiveAtMs: nowMs,
    state: normalizeGameState(state, nowMs),
  };

  try {
    storage.setItem(saveStorageKey, JSON.stringify(saveData));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedGame(): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(saveStorageKey);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSavedGame(rawSave: unknown, nowMs: number): GameState {
  if (!isRecord(rawSave) || rawSave.version !== 1 || !isRecord(rawSave.state)) {
    return createInitialState(nowMs);
  }

  return normalizeGameState(rawSave.state, nowMs, sanitizeTimestamp(rawSave.lastActiveAtMs, sanitizeTimestamp(rawSave.savedAtMs, nowMs)));
}

export function normalizeGameState(rawState: unknown, nowMs: number, fallbackUpdatedAtMs = nowMs): GameState {
  const initial = createInitialState(nowMs);
  if (!isRecord(rawState)) {
    return initial;
  }

  const currentZoneId = typeof rawState.currentZoneId === 'string' && zoneIds.has(rawState.currentZoneId)
    ? rawState.currentZoneId
    : initial.currentZoneId;

  const unlockedZoneIds = normalizeUnlockedZoneIds(rawState.unlockedZoneIds);
  if (!unlockedZoneIds.includes(currentZoneId)) {
    unlockedZoneIds.push(currentZoneId);
  }

  const normalizedUpgrades = normalizeUpgrades(rawState.upgrades);

  return {
    currencies: normalizeCurrencies(rawState.currencies),
    currentZoneId,
    excuseStock: normalizeExcuseStock(rawState.excuseStock, normalizedUpgrades),
    activeCustomers: normalizeCustomers(rawState.activeCustomers, nowMs, initial.activeCustomers),
    customerBatchNumber: sanitizeCount(rawState.customerBatchNumber),
    upgrades: normalizedUpgrades,
    unlockedZoneIds,
    lastUpdatedAtMs: sanitizeTimestamp(rawState.lastUpdatedAtMs, fallbackUpdatedAtMs),
  };
}

function normalizeCurrencies(value: unknown): GameState['currencies'] {
  if (!isRecord(value)) {
    return { coins: 0, smoothness: 0 };
  }

  return {
    coins: sanitizeCount(value.coins),
    smoothness: sanitizeCount(value.smoothness),
  };
}

function normalizeExcuseStock(value: unknown, normalizedUpgrades: UpgradeState): ExcuseStock {
  const stock = {} as ExcuseStock;
  const shelfLevel = sanitizeCount(normalizedUpgrades[stockCapUpgradeId]);
  starterExcuseIds.forEach((id) => {
    const rawCount = isRecord(value) ? value[id] : undefined;
    stock[id] = Math.min(getExcuseStockCapForLevel(id, shelfLevel), sanitizeCount(rawCount));
  });
  return stock;
}

function normalizeCustomers(value: unknown, nowMs: number, fallback: CustomerInstance[]): CustomerInstance[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((customer, index) => normalizeCustomer(customer, index, nowMs))
    .filter((customer): customer is CustomerInstance => customer !== undefined)
    .slice(0, 3);

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeCustomer(value: unknown, index: number, nowMs: number): CustomerInstance | undefined {
  if (!isRecord(value) || typeof value.customerId !== 'string') {
    return undefined;
  }

  const definition = customerById.get(value.customerId);
  if (!definition) {
    return undefined;
  }

  const wantedExcuseIds = Array.isArray(value.wantedExcuseIds)
    ? value.wantedExcuseIds.filter((id): id is ExcuseId => typeof id === 'string' && knownExcuseIds.has(id as ExcuseId))
    : [];
  const loadedStatus = value.status === 'served' ? 'served' : value.status === 'left' ? 'left' : 'waiting';
  const loadedCreatedAtMs = sanitizeTimestamp(value.createdAtMs, nowMs);
  const loadedPatienceMs = sanitizePositiveCount(value.patienceRemainingMs, getCustomerPatienceMs(definition));
  const elapsedMs = Math.max(0, nowMs - loadedCreatedAtMs);
  const remainingMs = loadedStatus === 'waiting' ? Math.max(0, loadedPatienceMs - elapsedMs) : 0;
  const status = loadedStatus === 'waiting' && remainingMs <= 0 ? 'left' : loadedStatus;
  const servedReward = status === 'served' ? normalizeServedReward(value.servedReward) : undefined;

  return {
    instanceId: typeof value.instanceId === 'string' && value.instanceId.length > 0
      ? value.instanceId
      : `loaded-${index}-${definition.id}`,
    customerId: definition.id,
    wantedExcuseIds: wantedExcuseIds.length > 0 ? wantedExcuseIds : [...definition.wantedExcuseIds],
    patienceRemainingMs: status === 'waiting' ? remainingMs : 0,
    createdAtMs: status === 'waiting' ? nowMs : loadedCreatedAtMs,
    status,
    servedAtMs: status === 'served' ? sanitizeTimestamp(value.servedAtMs, nowMs) : undefined,
    servedReward,
  };
}

function normalizeServedReward(value: unknown): CustomerInstance['servedReward'] {
  if (!isRecord(value) || typeof value.consumedExcuseId !== 'string' || !knownExcuseIds.has(value.consumedExcuseId as ExcuseId)) {
    return undefined;
  }

  return {
    coins: sanitizeCount(value.coins),
    smoothness: sanitizeCount(value.smoothness),
    consumedExcuseId: value.consumedExcuseId as ExcuseId,
  };
}

function normalizeUpgrades(value: unknown): UpgradeState {
  const normalized: UpgradeState = {};
  if (!isRecord(value)) {
    return normalized;
  }

  upgrades.forEach((upgrade) => {
    const level = Math.min(upgrade.maxLevel, sanitizeCount(value[upgrade.id]));
    if (level > 0) {
      normalized[upgrade.id] = level;
    }
  });

  return normalized;
}

function normalizeUnlockedZoneIds(value: unknown): string[] {
  const fromSave = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && zoneIds.has(id))
    : [];
  return [...new Set([...defaultZoneIds, ...fromSave])];
}

function sanitizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sanitizePositiveCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function isSaveDataV1Like(value: unknown): value is SaveDataV1 {
  return isRecord(value) && value.version === 1 && isRecord(value.state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
