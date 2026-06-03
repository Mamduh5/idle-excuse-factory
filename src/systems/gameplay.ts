import { customers } from '../data/customers';
import { excuses } from '../data/excuses';
import type {
  CustomerDefinition,
  CustomerInstance,
  ExcuseId,
  GameState,
} from '../types/game';

export type CraftResult = {
  crafted: boolean;
  excuseId: ExcuseId;
  stock: number;
  cap: number;
};

export type ServeResult = {
  served: boolean;
  customerName?: string;
  excuseId?: ExcuseId;
  coinsGained: number;
  smoothnessGained: number;
};

export type RefillResult = {
  refilled: boolean;
  batchNumber: number;
};

const customerById = new Map(customers.map((customer) => [customer.id, customer]));

export function craftExcuse(state: GameState, excuseId: ExcuseId): CraftResult {
  const definition = excuses[excuseId];
  const currentStock = sanitizeCount(state.excuseStock[excuseId]);
  const cap = sanitizeCount(definition.maxStock);

  if (currentStock >= cap) {
    state.excuseStock[excuseId] = cap;
    return {
      crafted: false,
      excuseId,
      stock: cap,
      cap,
    };
  }

  const nextStock = Math.min(cap, currentStock + 1);
  state.excuseStock[excuseId] = nextStock;

  return {
    crafted: true,
    excuseId,
    stock: nextStock,
    cap,
  };
}

export function serveCustomerByInstanceId(state: GameState, instanceId: string, nowMs = Date.now()): ServeResult {
  const match = state.activeCustomers.find((customer) => customer.instanceId === instanceId);
  if (!match || match.status !== 'waiting') {
    return emptyServeResult();
  }

  const definition = customerById.get(match.customerId);
  if (!definition) {
    return emptyServeResult();
  }

  return serveCustomer(state, match, definition, nowMs);
}

export function getWaitingCustomerByInstanceId(state: GameState, instanceId: string | undefined): CustomerInstance | undefined {
  if (!instanceId) {
    return undefined;
  }

  return state.activeCustomers.find((customer) => customer.instanceId === instanceId && customer.status === 'waiting');
}

export function getWantedExcuseIds(customer: CustomerInstance | undefined): ExcuseId[] {
  return customer ? customer.wantedExcuseIds : [];
}

export function hasMatchingStock(state: GameState, customer: CustomerInstance | undefined): boolean {
  return findFirstAvailableWantedExcuse(state, customer) !== undefined;
}

export function findFirstAvailableWantedExcuse(
  state: GameState,
  customer: CustomerInstance | undefined,
): ExcuseId | undefined {
  return getWantedExcuseIds(customer).find((excuseId) => sanitizeCount(state.excuseStock[excuseId]) > 0);
}

export function canRefillCustomerBatch(state: GameState): boolean {
  return state.activeCustomers.every((customer) => customer.status !== 'waiting');
}

export function refillCustomerBatch(state: GameState, nowMs = Date.now()): RefillResult {
  if (!canRefillCustomerBatch(state)) {
    return {
      refilled: false,
      batchNumber: state.customerBatchNumber,
    };
  }

  const batchNumber = sanitizeCount(state.customerBatchNumber) + 1;
  state.customerBatchNumber = batchNumber;
  state.activeCustomers = createCustomerBatch(batchNumber, nowMs);
  state.lastUpdatedAtMs = nowMs;

  return {
    refilled: true,
    batchNumber,
  };
}

function createCustomerBatch(batchNumber: number, nowMs: number): CustomerInstance[] {
  return customers.slice(0, 3).map((customer, index) => ({
    instanceId: `batch-${batchNumber}-${index}-${customer.id}`,
    customerId: customer.id,
    wantedExcuseIds: [...customer.wantedExcuseIds],
    patienceRemainingMs: 0,
    createdAtMs: nowMs,
    status: 'waiting',
  }));
}

function serveCustomer(
  state: GameState,
  instance: CustomerInstance,
  customer: CustomerDefinition,
  nowMs: number,
): ServeResult {
  const excuseId = findFirstAvailableWantedExcuse(state, instance);
  if (!excuseId) {
    return emptyServeResult();
  }

  const excuse = excuses[excuseId];
  const stock = sanitizeCount(state.excuseStock[excuseId]);

  if (instance.status !== 'waiting' || stock <= 0) {
    return emptyServeResult();
  }

  const coinsGained = sanitizeCount(Math.floor(excuse.baseValue * customer.coinMultiplier));
  const smoothnessGained = sanitizeCount(customer.smoothnessReward);

  state.excuseStock[excuseId] = Math.max(0, stock - 1);
  state.currencies.coins = sanitizeCount(state.currencies.coins + coinsGained);
  state.currencies.smoothness = sanitizeCount(state.currencies.smoothness + smoothnessGained);
  instance.status = 'served';
  instance.servedAtMs = nowMs;
  instance.servedReward = {
    coins: coinsGained,
    smoothness: smoothnessGained,
    consumedExcuseId: excuseId,
  };
  state.lastUpdatedAtMs = nowMs;

  return {
    served: true,
    customerName: customer.displayName,
    excuseId,
    coinsGained,
    smoothnessGained,
  };
}

function emptyServeResult(): ServeResult {
  return {
    served: false,
    coinsGained: 0,
    smoothnessGained: 0,
  };
}

function sanitizeCurrencies(state: GameState): void {
  state.currencies.coins = sanitizeCount(state.currencies.coins);
  state.currencies.smoothness = sanitizeCount(state.currencies.smoothness);
}

function sanitizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
