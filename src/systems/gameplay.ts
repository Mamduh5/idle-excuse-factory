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

export type StockChangeResult = {
  craft: CraftResult;
  serve: ServeResult;
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

export function craftAndAutoServe(state: GameState, excuseId: ExcuseId, nowMs = Date.now()): StockChangeResult {
  const craft = craftExcuse(state, excuseId);
  const serve = craft.crafted ? autoServeOneCustomer(state, nowMs) : emptyServeResult();
  sanitizeCurrencies(state);

  return { craft, serve };
}

export function autoServeOneCustomer(state: GameState, nowMs = Date.now()): ServeResult {
  const match = state.activeCustomers.find((customer) => {
    return customer.status === 'waiting' && sanitizeCount(state.excuseStock[customer.wantedExcuseId]) > 0;
  });

  if (!match) {
    return emptyServeResult();
  }

  const definition = customerById.get(match.customerId);
  if (!definition) {
    return emptyServeResult();
  }

  return serveCustomer(state, match, definition, nowMs);
}

function serveCustomer(
  state: GameState,
  instance: CustomerInstance,
  customer: CustomerDefinition,
  nowMs: number,
): ServeResult {
  const excuse = excuses[instance.wantedExcuseId];
  const stock = sanitizeCount(state.excuseStock[instance.wantedExcuseId]);

  if (instance.status !== 'waiting' || stock <= 0) {
    return emptyServeResult();
  }

  const coinsGained = sanitizeCount(Math.floor(excuse.baseValue * customer.coinMultiplier));
  const smoothnessGained = sanitizeCount(customer.smoothnessReward);

  state.excuseStock[instance.wantedExcuseId] = Math.max(0, stock - 1);
  state.currencies.coins = sanitizeCount(state.currencies.coins + coinsGained);
  state.currencies.smoothness = sanitizeCount(state.currencies.smoothness + smoothnessGained);
  instance.status = 'served';
  instance.servedAtMs = nowMs;
  state.lastUpdatedAtMs = nowMs;

  return {
    served: true,
    customerName: customer.displayName,
    excuseId: instance.wantedExcuseId,
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
