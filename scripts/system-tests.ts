import { excuses } from '../src/data/excuses';
import { createInitialState } from '../src/state/initialState';
import { clearSavedGame, normalizeGameState, normalizeSavedGame, saveGameState } from '../src/services/saveService';
import {
  canRefillCustomerBatch,
  craftExcuse,
  expireCustomerPatience,
  findFirstAvailableWantedExcuse,
  getCustomerPatienceRemainingMs,
  refillCustomerBatch,
  serveCustomerByInstanceId,
} from '../src/systems/gameplay';
import { calculateOfflineEarnings, offlineEarningsCapMs } from '../src/systems/offlineEarnings';
import {
  calculateUpgradeCost,
  getExcuseStockCap,
  getUpgradeById,
  getUpgradeLevel,
  purchaseUpgrade,
} from '../src/systems/upgrades';
import type { GameState } from '../src/types/game';

type TestCase = {
  name: string;
  run: () => void;
};

const nowMs = 1_700_000_000_000;

const tests: TestCase[] = [
  {
    name: 'crafting increases stock and stops at base cap',
    run: () => {
      const state = createInitialState(nowMs);
      const first = craftExcuse(state, 'traffic_jam');
      assertEqual(first.crafted, true, 'first craft succeeds');
      assertEqual(first.stock, 1, 'first craft stock');
      assertEqual(first.cap, excuses.traffic_jam.maxStock, 'base cap is used');

      for (let index = 0; index < 10; index += 1) {
        craftExcuse(state, 'traffic_jam');
      }

      const overflow = craftExcuse(state, 'traffic_jam');
      assertEqual(overflow.crafted, false, 'craft over cap is blocked');
      assertEqual(state.excuseStock.traffic_jam, excuses.traffic_jam.maxStock, 'stock stays at cap');
    },
  },
  {
    name: 'Bigger Shelf raises stock cap and crafting respects it',
    run: () => {
      const state = createInitialState(nowMs);
      state.upgrades.bigger_shelf = 1;
      const upgradedCap = getExcuseStockCap(state, 'traffic_jam');
      assertEqual(upgradedCap, excuses.traffic_jam.maxStock + 2, 'Bigger Shelf cap');

      for (let index = 0; index < upgradedCap + 3; index += 1) {
        craftExcuse(state, 'traffic_jam');
      }

      assertEqual(state.excuseStock.traffic_jam, upgradedCap, 'stock stays at upgraded cap');
    },
  },
  {
    name: 'serving consumes one stock and grants base rewards once',
    run: () => {
      const state = createInitialState(nowMs);
      state.excuseStock.traffic_jam = 1;

      const served = serveCustomerByInstanceId(state, 'starter-late-worker', nowMs + 100);
      assertEqual(served.served, true, 'serve succeeds');
      assertEqual(served.excuseId, 'traffic_jam', 'served excuse');
      assertEqual(served.coinsGained, 10, 'base coins');
      assertEqual(served.smoothnessGained, 1, 'base smoothness');
      assertEqual(state.excuseStock.traffic_jam, 0, 'exactly one stock consumed');
      assertEqual(state.currencies.coins, 10, 'coins granted');
      assertEqual(state.currencies.smoothness, 1, 'smoothness granted');

      const repeated = serveCustomerByInstanceId(state, 'starter-late-worker', nowMs + 200);
      assertEqual(repeated.served, false, 'served customer cannot reward again');
      assertEqual(state.currencies.coins, 10, 'coins unchanged after repeated serve');
      assertEqual(state.currencies.smoothness, 1, 'smoothness unchanged after repeated serve');
    },
  },
  {
    name: 'patience expiration marks waiting customer left',
    run: () => {
      const state = createInitialState(nowMs);
      const result = expireCustomerPatience(state, nowMs + 61_000);
      assertEqual(result.expiredInstanceIds.includes('starter-late-worker'), true, 'late worker expired');
      assertEqual(state.activeCustomers[0].status, 'left', 'expired customer marked left');
      assertEqual(state.currencies.coins, 0, 'no coin penalty');
      assertEqual(state.currencies.smoothness, 0, 'no smoothness penalty');
    },
  },
  {
    name: 'expired customer cannot be served or grant rewards',
    run: () => {
      const state = createInitialState(nowMs);
      state.excuseStock.traffic_jam = 1;
      expireCustomerPatience(state, nowMs + 61_000);

      const result = serveCustomerByInstanceId(state, 'starter-late-worker', nowMs + 61_500);
      assertEqual(result.served, false, 'expired customer is not served');
      assertEqual(state.excuseStock.traffic_jam, 1, 'expired customer consumes no stock');
      assertEqual(state.currencies.coins, 0, 'expired customer grants no coins');
      assertEqual(state.currencies.smoothness, 0, 'expired customer grants no smoothness');
    },
  },
  {
    name: 'missing stock does not grant serving rewards',
    run: () => {
      const state = createInitialState(nowMs);
      const result = serveCustomerByInstanceId(state, 'starter-late-worker', nowMs + 100);
      assertEqual(result.served, false, 'serve without stock is blocked');
      assertEqual(result.coinsGained, 0, 'no coins without stock');
      assertEqual(result.smoothnessGained, 0, 'no smoothness without stock');
      assertEqual(state.currencies.coins, 0, 'state coins unchanged');
    },
  },
  {
    name: 'multi-excuse customer uses wantedExcuseIds order deterministically',
    run: () => {
      const state = createInitialState(nowMs);
      const ghost = state.activeCustomers.find((customer) => customer.customerId === 'ghost_texter');
      assert(ghost !== undefined, 'ghost customer exists');
      state.excuseStock.battery_dead = 1;
      state.excuseStock.just_saw_message = 1;

      assertEqual(findFirstAvailableWantedExcuse(state, ghost), 'battery_dead', 'first wanted stocked excuse wins');
      const result = serveCustomerByInstanceId(state, ghost.instanceId, nowMs + 100);
      assertEqual(result.served, true, 'ghost serve succeeds');
      assertEqual(result.excuseId, 'battery_dead', 'battery excuse consumed first');
      assertEqual(state.excuseStock.battery_dead, 0, 'first matching stock consumed');
      assertEqual(state.excuseStock.just_saw_message, 1, 'later matching stock preserved');
    },
  },
  {
    name: 'refill is allowed when all customers are served or left',
    run: () => {
      const state = createInitialState(nowMs);
      state.activeCustomers[0].status = 'served';
      state.activeCustomers[1].status = 'left';
      state.activeCustomers[2].status = 'served';

      assertEqual(canRefillCustomerBatch(state), true, 'inactive customers allow refill');
      const refill = refillCustomerBatch(state, nowMs + 100);
      assertEqual(refill.refilled, true, 'refill succeeds');
      assertEqual(state.activeCustomers.every((customer) => customer.status === 'waiting'), true, 'new batch is waiting');
      assertEqual(
        state.activeCustomers.every((customer) => getCustomerPatienceRemainingMs(customer, nowMs + 100) > 0),
        true,
        'new batch has fresh patience',
      );
    },
  },
  {
    name: 'upgrade purchase subtracts cost and increases level',
    run: () => {
      const state = createInitialState(nowMs);
      state.currencies.coins = 500;
      const upgrade = requireUpgrade('bigger_shelf');
      const expectedCost = calculateUpgradeCost(upgrade, 0);

      const result = purchaseUpgrade(state, 'bigger_shelf', nowMs + 100);
      assertEqual(result.purchased, true, 'purchase succeeds');
      assertEqual(result.cost, expectedCost, 'reported cost');
      assertEqual(state.currencies.coins, 500 - expectedCost, 'coins subtracted');
      assertEqual(getUpgradeLevel(state, 'bigger_shelf'), 1, 'level increased');
    },
  },
  {
    name: 'upgrade purchase is blocked when coins are insufficient',
    run: () => {
      const state = createInitialState(nowMs);
      state.currencies.coins = 0;

      const result = purchaseUpgrade(state, 'premium_bullshit', nowMs + 100);
      assertEqual(result.purchased, false, 'purchase is blocked');
      assertEqual(result.reason, 'not_enough_coins', 'insufficient reason');
      assertEqual(state.currencies.coins, 0, 'coins stay safe');
      assertEqual(getUpgradeLevel(state, 'premium_bullshit'), 0, 'level unchanged');
    },
  },
  {
    name: 'Premium Bullshit increases served coin rewards',
    run: () => {
      const state = createInitialState(nowMs);
      state.currencies.coins = 1_000;
      purchaseUpgrade(state, 'premium_bullshit', nowMs + 100);
      state.excuseStock.traffic_jam = 1;
      const coinsBeforeServe = state.currencies.coins;

      const result = serveCustomerByInstanceId(state, 'starter-late-worker', nowMs + 200);
      assertEqual(result.served, true, 'serve succeeds after premium upgrade');
      assertEqual(result.coinsGained, 11, '10 base coins gets 10 percent bonus');
      assertEqual(state.currencies.coins, coinsBeforeServe + 11, 'state receives upgraded coins');
    },
  },
  {
    name: 'Smooth Talk increases served smoothness rewards',
    run: () => {
      const state = createInitialState(nowMs);
      state.currencies.coins = 1_000;
      purchaseUpgrade(state, 'smoother_words', nowMs + 100);
      state.excuseStock.traffic_jam = 1;

      const result = serveCustomerByInstanceId(state, 'starter-late-worker', nowMs + 200);
      assertEqual(result.served, true, 'serve succeeds after smooth upgrade');
      assertEqual(result.smoothnessGained, 2, 'base smoothness plus one');
      assertEqual(state.currencies.smoothness, 2, 'state receives upgraded smoothness');
    },
  },
  {
    name: 'offline earnings ignore short and negative durations',
    run: () => {
      assertEqual(calculateOfflineEarnings(nowMs - 29_000, nowMs), undefined, 'under 30 seconds earns nothing');
      assertEqual(calculateOfflineEarnings(nowMs + 1_000, nowMs), undefined, 'negative duration earns nothing');
    },
  },
  {
    name: 'offline earnings cap at 2 hours and calculate 90 minutes',
    run: () => {
      const ninetyMinutes = calculateOfflineEarnings(nowMs - 90 * 60 * 1000, nowMs);
      assert(ninetyMinutes !== undefined, '90 minute offline reward exists');
      assertEqual(ninetyMinutes.coins, 450, '90 minutes gives 450 coins');
      assertEqual(ninetyMinutes.cappedSeconds, 90 * 60, '90 minutes is uncapped');

      const longAway = calculateOfflineEarnings(nowMs - 6 * 60 * 60 * 1000, nowMs);
      assert(longAway !== undefined, 'long offline reward exists');
      assertEqual(longAway.cappedSeconds, offlineEarningsCapMs / 1000, 'long duration caps at 2 hours');
      assertEqual(longAway.coins, 600, '2 hour cap gives 600 coins');
    },
  },
  {
    name: 'save normalization handles invalid raw shape safely',
    run: () => {
      const normalized = normalizeSavedGame({ version: 1, state: 'bad' }, nowMs);
      assertEqual(normalized.currencies.coins, 0, 'invalid save coins default');
      assertEqual(normalized.currentZoneId, 'daily_life', 'invalid save zone default');
      assertEqual(normalized.activeCustomers.length, 3, 'invalid save customers default');
    },
  },
  {
    name: 'save normalization sanitizes currency, IDs, and upgraded stock cap',
    run: () => {
      const rawState = {
        currencies: {
          coins: Number.POSITIVE_INFINITY,
          smoothness: -10,
        },
        currentZoneId: 'unknown_zone',
        excuseStock: {
          traffic_jam: 999,
          battery_dead: Number.NaN,
          just_saw_message: 2,
          unknown_excuse: 50,
        },
        activeCustomers: [
          {
            instanceId: '',
            customerId: 'unknown_customer',
            wantedExcuseIds: ['traffic_jam'],
            patienceRemainingMs: -50,
            createdAtMs: -1,
            status: 'waiting',
          },
        ],
        customerBatchNumber: -5,
        upgrades: {
          bigger_shelf: 1,
          premium_bullshit: 99,
          unknown_upgrade: 4,
        },
        unlockedZoneIds: ['office_zone', 'bad_zone'],
        lastUpdatedAtMs: -1,
      };

      const normalized = normalizeGameState(rawState, nowMs);
      assertEqual(normalized.currencies.coins, 0, 'invalid coins sanitize to zero');
      assertEqual(normalized.currencies.smoothness, 0, 'negative smoothness sanitizes to zero');
      assertEqual(normalized.currentZoneId, 'daily_life', 'unknown current zone defaults');
      assertEqual(normalized.excuseStock.traffic_jam, 7, 'stock clamps to upgraded cap');
      assertEqual(normalized.excuseStock.battery_dead, 0, 'NaN stock sanitizes to zero');
      assertEqual(normalized.excuseStock.just_saw_message, 2, 'valid stock persists');
      assertEqual(getUpgradeLevel(normalized, 'bigger_shelf'), 1, 'known upgrade persists');
      assertEqual(getUpgradeLevel(normalized, 'premium_bullshit'), 5, 'upgrade clamps to max');
      assertEqual(normalized.upgrades.unknown_upgrade, undefined, 'unknown upgrade ignored');
      assertEqual(normalized.unlockedZoneIds.includes('daily_life'), true, 'default zone included');
      assertEqual(normalized.unlockedZoneIds.includes('office_zone'), true, 'known unlocked zone persists');
      assertEqual(normalized.unlockedZoneIds.includes('bad_zone'), false, 'unknown zone ignored');
      assertEqual(normalized.activeCustomers.length, 3, 'invalid customer list falls back');
      assertEqual(normalized.customerBatchNumber, 0, 'negative batch sanitizes');
      assertEqual(normalized.lastUpdatedAtMs, nowMs, 'invalid timestamp falls back');
    },
  },
  {
    name: 'save normalization marks loaded expired waiting customers left',
    run: () => {
      const normalized = normalizeGameState(
        {
          currencies: { coins: 0, smoothness: 0 },
          currentZoneId: 'daily_life',
          excuseStock: {},
          activeCustomers: [
            {
              instanceId: 'loaded-late-worker',
              customerId: 'late_worker',
              wantedExcuseIds: ['traffic_jam'],
              patienceRemainingMs: 60_000,
              createdAtMs: nowMs - 61_000,
              status: 'waiting',
            },
          ],
          customerBatchNumber: 0,
          upgrades: {},
          unlockedZoneIds: ['daily_life'],
          lastUpdatedAtMs: nowMs - 61_000,
        },
        nowMs,
      );

      assertEqual(normalized.activeCustomers[0].status, 'left', 'loaded expired customer is left');
      assertEqual(normalized.activeCustomers[0].patienceRemainingMs, 0, 'expired patience is zero');
    },
  },
  {
    name: 'save service is safe without browser localStorage',
    run: () => {
      const originalLocalStorage = globalThis.localStorage;
      const hadLocalStorage = 'localStorage' in globalThis;
      try {
        delete (globalThis as { localStorage?: Storage }).localStorage;
        assertEqual(saveGameState(createInitialState(nowMs), nowMs), false, 'save returns false without storage');
        assertEqual(clearSavedGame(), false, 'clear returns false without storage');
      } finally {
        if (hadLocalStorage) {
          (globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
        }
      }
    },
  },
];

runTests(tests);

function runTests(cases: TestCase[]): void {
  let passed = 0;
  cases.forEach((test) => {
    test.run();
    passed += 1;
    console.log(`ok ${passed} - ${test.name}`);
  });
  console.log(`\n${passed}/${cases.length} system tests passed`);
}

function requireUpgrade(upgradeId: string) {
  const upgrade = getUpgradeById(upgradeId);
  assert(upgrade !== undefined, `${upgradeId} upgrade exists`);
  return upgrade;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${formatValue(expected)}, got ${formatValue(actual)}`);
  }
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}
