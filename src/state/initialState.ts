import { customers } from '../data/customers';
import { starterExcuseIds } from '../data/excuses';
import { getCustomerPatienceMs } from '../systems/gameplay';
import type { ExcuseStock, GameState } from '../types/game';

const starterStock = starterExcuseIds.reduce<ExcuseStock>((stock, id) => {
  stock[id] = 0;
  return stock;
}, {} as ExcuseStock);

export function createInitialState(nowMs = Date.now()): GameState {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  return {
    currencies: {
      coins: 0,
      smoothness: 0,
    },
    currentZoneId: 'daily_life',
    excuseStock: { ...starterStock },
    activeCustomers: [
      {
        instanceId: 'starter-late-worker',
        customerId: 'late_worker',
        wantedExcuseIds: ['traffic_jam'],
        patienceRemainingMs: getCustomerPatienceMs(customerById.get('late_worker') ?? customers[0]),
        createdAtMs: nowMs,
        status: 'waiting',
      },
      {
        instanceId: 'starter-missing-student',
        customerId: 'missing_student',
        wantedExcuseIds: ['just_saw_message'],
        patienceRemainingMs: getCustomerPatienceMs(customerById.get('missing_student') ?? customers[1]),
        createdAtMs: nowMs,
        status: 'waiting',
      },
      {
        instanceId: 'starter-ghost-texter',
        customerId: 'ghost_texter',
        wantedExcuseIds: ['battery_dead', 'just_saw_message'],
        patienceRemainingMs: getCustomerPatienceMs(customerById.get('ghost_texter') ?? customers[2]),
        createdAtMs: nowMs,
        status: 'waiting',
      },
    ],
    customerBatchNumber: 0,
    upgrades: {},
    unlockedZoneIds: ['daily_life'],
    lastUpdatedAtMs: nowMs,
  };
}
