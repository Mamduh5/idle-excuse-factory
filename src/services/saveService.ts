import { customers } from '../data/customers';
import { excuses, starterExcuseIds } from '../data/excuses';
import { upgrades } from '../data/upgrades';
import { zones } from '../data/zones';
import { createInitialState } from '../state/initialState';
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
    return {
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

function normalizeSavedGame(rawSave: unknown, nowMs: number): GameState {
  if (!isRecord(rawSave) || rawSave.version !== 1 || !isRecord(rawSave.state)) {
    return createInitialState(nowMs);
  }

  return normalizeGameState(rawSave.state, nowMs, sanitizeTimestamp(rawSave.lastActiveAtMs, sanitizeTimestamp(rawSave.savedAtMs, nowMs)));
}

function normalizeGameState(rawState: unknown, nowMs: number, fallbackUpdatedAtMs = nowMs): GameState {
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

  return {
    currencies: normalizeCurrencies(rawState.currencies),
    currentZoneId,
    excuseStock: normalizeExcuseStock(rawState.excuseStock),
    activeCustomers: normalizeCustomers(rawState.activeCustomers, nowMs, initial.activeCustomers),
    customerBatchNumber: sanitizeCount(rawState.customerBatchNumber),
    upgrades: normalizeUpgrades(rawState.upgrades),
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

function normalizeExcuseStock(value: unknown): ExcuseStock {
  const stock = {} as ExcuseStock;
  starterExcuseIds.forEach((id) => {
    const rawCount = isRecord(value) ? value[id] : undefined;
    stock[id] = Math.min(excuses[id].maxStock, sanitizeCount(rawCount));
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
  const status = value.status === 'served' ? 'served' : 'waiting';
  const servedReward = status === 'served' ? normalizeServedReward(value.servedReward) : undefined;

  return {
    instanceId: typeof value.instanceId === 'string' && value.instanceId.length > 0
      ? value.instanceId
      : `loaded-${index}-${definition.id}`,
    customerId: definition.id,
    wantedExcuseIds: wantedExcuseIds.length > 0 ? wantedExcuseIds : [...definition.wantedExcuseIds],
    patienceRemainingMs: sanitizeCount(value.patienceRemainingMs),
    createdAtMs: sanitizeTimestamp(value.createdAtMs, nowMs),
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

function sanitizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
