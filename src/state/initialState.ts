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
    activeCustomers: [],
    upgrades: {},
    unlockedZoneIds: ['daily_life'],
    lastUpdatedAtMs: nowMs,
  };
}
