import { createInitialState } from '../state/initialState';
import type { CustomerInstance, ExcuseId, GameState, SaveDataV1 } from '../types/game';
import { saveStorageKey } from './saveService';

export type DevSaveSeedId =
  | 'fresh'
  | 'partial_one_inactive'
  | 'partial_two_inactive'
  | 'partial_one_waiting'
  | 'progress';

export type DevSaveSeedDefinition = {
  id: DevSaveSeedId;
  label: string;
};

export const devSaveSeedDefinitions: DevSaveSeedDefinition[] = [
  { id: 'fresh', label: 'Fresh' },
  { id: 'partial_one_inactive', label: '1 inactive' },
  { id: 'partial_two_inactive', label: '2 inactive' },
  { id: 'partial_one_waiting', label: '1 waiting' },
  { id: 'progress', label: 'Progress' },
];

export function createDevSaveSeed(seedId: DevSaveSeedId, nowMs = Date.now()): SaveDataV1 {
  return {
    version: 1,
    savedAtMs: nowMs,
    lastActiveAtMs: nowMs,
    state: createSeedState(seedId, nowMs),
  };
}

export function writeDevSaveSeed(seedId: DevSaveSeedId, nowMs = Date.now()): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(saveStorageKey, JSON.stringify(createDevSaveSeed(seedId, nowMs)));
    return true;
  } catch {
    return false;
  }
}

function createSeedState(seedId: DevSaveSeedId, nowMs: number): GameState {
  const state = createInitialState(nowMs);

  if (seedId === 'fresh') {
    return state;
  }

  if (seedId === 'partial_one_inactive') {
    state.activeCustomers = [
      createServedCustomer(state.activeCustomers[0], nowMs - 4_000, 10, 1, 'traffic_jam'),
    ];
    return state;
  }

  if (seedId === 'partial_two_inactive') {
    state.activeCustomers = [
      createServedCustomer(state.activeCustomers[0], nowMs - 5_000, 10, 1, 'traffic_jam'),
      createLeftCustomer(state.activeCustomers[1], nowMs - 3_000),
    ];
    return state;
  }

  if (seedId === 'partial_one_waiting') {
    state.activeCustomers = [
      {
        ...state.activeCustomers[0],
        instanceId: 'dev-waiting-late-worker',
        createdAtMs: nowMs,
      },
    ];
    return state;
  }

  state.currencies.coins = 125;
  state.currencies.smoothness = 4;
  state.excuseStock.traffic_jam = 2;
  state.excuseStock.battery_dead = 1;
  state.excuseStock.just_saw_message = 3;
  state.upgrades.bigger_shelf = 1;
  state.activeCustomers = [
    createServedCustomer(state.activeCustomers[0], nowMs - 6_000, 11, 1, 'traffic_jam'),
    state.activeCustomers[1],
    state.activeCustomers[2],
  ];
  return state;
}

function createServedCustomer(
  source: CustomerInstance,
  servedAtMs: number,
  coins: number,
  smoothness: number,
  consumedExcuseId: ExcuseId,
): CustomerInstance {
  return {
    ...source,
    instanceId: `dev-served-${source.customerId}`,
    patienceRemainingMs: 0,
    createdAtMs: servedAtMs,
    status: 'served',
    servedAtMs,
    servedReward: {
      coins,
      smoothness,
      consumedExcuseId,
    },
  };
}

function createLeftCustomer(source: CustomerInstance, leftAtMs: number): CustomerInstance {
  return {
    ...source,
    instanceId: `dev-left-${source.customerId}`,
    patienceRemainingMs: 0,
    createdAtMs: leftAtMs,
    status: 'left',
  };
}

function getStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
