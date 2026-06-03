import { starterExcuseIds } from '../data/excuses';
import type { ExcuseStock, GameState } from '../types/game';

const starterStock = starterExcuseIds.reduce<ExcuseStock>((stock, id) => {
  stock[id] = 0;
  return stock;
}, {} as ExcuseStock);

export function createInitialState(nowMs = Date.now()): GameState {
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
        wantedExcuseId: 'traffic_jam',
        patienceRemainingMs: 0,
        createdAtMs: nowMs,
        status: 'waiting',
      },
      {
        instanceId: 'starter-missing-student',
        customerId: 'missing_student',
        wantedExcuseId: 'just_saw_message',
        patienceRemainingMs: 0,
        createdAtMs: nowMs,
        status: 'waiting',
      },
      {
        instanceId: 'starter-ghost-texter',
        customerId: 'ghost_texter',
        wantedExcuseId: 'battery_dead',
        patienceRemainingMs: 0,
        createdAtMs: nowMs,
        status: 'waiting',
      },
    ],
    upgrades: {},
    unlockedZoneIds: ['daily_life'],
    lastUpdatedAtMs: nowMs,
  };
}
