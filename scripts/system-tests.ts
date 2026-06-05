import { excuses } from '../src/data/excuses';
import { createDevSaveSeed, devSaveSeedDefinitions } from '../src/services/devSaveSeeds';
import { createInitialState } from '../src/state/initialState';
import { clearSavedGame, normalizeGameState, normalizeSavedGame, saveGameState } from '../src/services/saveService';
import {
  canRefillCustomerBatch,
  completeCrafts,
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
  calculateCraftDurationMs,
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
    name: 'starting a craft does not immediately increase stock',
    run: () => {
      const state = createInitialState(nowMs);
      const first = craftExcuse(state, 'traffic_jam', nowMs);
      assertEqual(first.started, true, 'first craft starts');
      assertEqual(first.stock, 0, 'reported stock is unchanged');
      assertEqual(state.excuseStock.traffic_jam, 0, 'stock does not increase immediately');
      assertEqual(first.cap, excuses.traffic_jam.maxStock, 'base cap is used');
      assert(state.activeCrafts.traffic_jam !== undefined, 'active craft is recorded');
      assertEqual(state.activeCrafts.traffic_jam?.startedAtMs, nowMs, 'craft start time saved');
    },
  },
  {
    name: 'craft completion increases stock by 1',
    run: () => {
      const state = createInitialState(nowMs);
      const first = craftExcuse(state, 'traffic_jam', nowMs);
      assertEqual(first.started, true, 'craft starts');

      const early = completeCrafts(state, nowMs + 2_000);
      assertEqual(early.completed.length, 0, 'craft does not complete early');
      assertEqual(state.excuseStock.traffic_jam, 0, 'early stock unchanged');

      const completed = completeCrafts(state, nowMs + 3_000);
      assertEqual(completed.completed.length, 1, 'one craft completes');
      assertEqual(completed.completed[0].excuseId, 'traffic_jam', 'completed excuse');
      assertEqual(completed.completed[0].granted, true, 'completed craft grants stock');
      assertEqual(state.excuseStock.traffic_jam, 1, 'completion grants exactly one stock');
      assertEqual(state.activeCrafts.traffic_jam, undefined, 'active craft is cleared');
    },
  },
  {
    name: 'craft cannot start when stock is full',
    run: () => {
      const state = createInitialState(nowMs);
      state.excuseStock.traffic_jam = excuses.traffic_jam.maxStock;
      const result = craftExcuse(state, 'traffic_jam', nowMs);
      assertEqual(result.started, false, 'full stock blocks craft');
      assertEqual(result.reason, 'full', 'full reason');
      assertEqual(state.activeCrafts.traffic_jam, undefined, 'no active craft starts');
      assertEqual(state.excuseStock.traffic_jam, excuses.traffic_jam.maxStock, 'stock stays at cap');
    },
  },
  {
    name: 'craft cannot start twice for the same excuse',
    run: () => {
      const state = createInitialState(nowMs);
      const first = craftExcuse(state, 'traffic_jam', nowMs);
      const duplicate = craftExcuse(state, 'traffic_jam', nowMs + 100);
      assertEqual(first.started, true, 'first craft starts');
      assertEqual(duplicate.started, false, 'duplicate craft is blocked');
      assertEqual(duplicate.reason, 'already_crafting', 'duplicate reason');
      assertEqual(state.excuseStock.traffic_jam, 0, 'duplicate does not add stock');
      assertEqual(state.activeCrafts.traffic_jam?.startedAtMs, nowMs, 'original craft is preserved');
    },
  },
  {
    name: 'Bigger Shelf raises stock cap and timed crafting respects it',
    run: () => {
      const state = createInitialState(nowMs);
      state.upgrades.bigger_shelf = 1;
      const upgradedCap = getExcuseStockCap(state, 'traffic_jam');
      assertEqual(upgradedCap, excuses.traffic_jam.maxStock + 2, 'Bigger Shelf cap');

      for (let index = 0; index < upgradedCap; index += 1) {
        const started = craftExcuse(state, 'traffic_jam', nowMs + index * 10_000);
        assertEqual(started.started, true, 'craft starts under upgraded cap');
        completeCrafts(state, nowMs + index * 10_000 + 10_000);
      }

      const overflow = craftExcuse(state, 'traffic_jam', nowMs + 100_000);
      assertEqual(overflow.started, false, 'craft over upgraded cap is blocked');
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
    name: 'printer upgrade reduces craft duration',
    run: () => {
      const state = createInitialState(nowMs);
      const baseDuration = calculateCraftDurationMs(state, 'traffic_jam');
      state.currencies.coins = 1_000;

      const result = purchaseUpgrade(state, 'extra_printer', nowMs + 100);
      assertEqual(result.purchased, true, 'printer upgrade is buyable');
      assertEqual(getUpgradeLevel(state, 'extra_printer'), 1, 'printer level increased');
      const upgradedDuration = calculateCraftDurationMs(state, 'traffic_jam');
      assertEqual(upgradedDuration < baseDuration, true, 'printer upgrade reduces duration');
      assertEqual(upgradedDuration, Math.ceil(baseDuration / 1.1), 'printer formula divides by speed multiplier');
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
    name: 'initial state has no active crafts',
    run: () => {
      const state = createInitialState(nowMs);
      assertEqual(Object.keys(state.activeCrafts).length, 0, 'initial active crafts are empty');
    },
  },
  {
    name: 'save normalization handles active crafts safely',
    run: () => {
      const normalized = normalizeGameState(
        {
          ...createRawStateWithCustomers([]),
          activeCrafts: {
            traffic_jam: 'bad craft',
            battery_dead: {
              startedAtMs: nowMs - 1_000,
              completesAtMs: nowMs + 3_000,
            },
            unknown_excuse: {
              startedAtMs: nowMs - 1_000,
              completesAtMs: nowMs + 3_000,
            },
          },
        },
        nowMs,
      );

      assertEqual(normalized.activeCrafts.traffic_jam, undefined, 'invalid craft is ignored');
      assert(normalized.activeCrafts.battery_dead !== undefined, 'valid active craft persists');
      assertEqual(normalized.activeCrafts.battery_dead?.completesAtMs, nowMs + 3_000, 'future completion time persists');
      assertEqual(normalized.activeCrafts.just_saw_message, undefined, 'missing active craft defaults empty');
    },
  },
  {
    name: 'completed craft during load grants at most one stock and clears craft',
    run: () => {
      const normalized = normalizeGameState(
        {
          ...createRawStateWithCustomers([]),
          excuseStock: {
            traffic_jam: 4,
          },
          activeCrafts: {
            traffic_jam: {
              startedAtMs: nowMs - 10_000,
              completesAtMs: nowMs - 7_000,
            },
          },
        },
        nowMs,
      );

      assertEqual(normalized.excuseStock.traffic_jam, 5, 'completed craft grants exactly one stock');
      assertEqual(normalized.activeCrafts.traffic_jam, undefined, 'completed craft clears active craft');
    },
  },
  {
    name: 'completed craft during load does not exceed stock cap',
    run: () => {
      const normalized = normalizeGameState(
        {
          ...createRawStateWithCustomers([]),
          excuseStock: {
            traffic_jam: excuses.traffic_jam.maxStock,
          },
          activeCrafts: {
            traffic_jam: {
              startedAtMs: nowMs - 10_000,
              completesAtMs: nowMs - 7_000,
            },
          },
        },
        nowMs,
      );

      assertEqual(normalized.excuseStock.traffic_jam, excuses.traffic_jam.maxStock, 'stock remains capped');
      assertEqual(normalized.activeCrafts.traffic_jam, undefined, 'capped completed craft is cleared');
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
    name: 'save normalization pads one cleared loaded customer to a refillable three-slot queue',
    run: () => {
      const normalized = normalizeGameState(
        createRawStateWithCustomers([
          {
            instanceId: 'loaded-late-worker',
            customerId: 'late_worker',
            wantedExcuseIds: ['traffic_jam'],
            patienceRemainingMs: 0,
            createdAtMs: nowMs - 1_000,
            status: 'served',
            servedAtMs: nowMs - 500,
            servedReward: {
              coins: 10,
              smoothness: 1,
              consumedExcuseId: 'traffic_jam',
            },
          },
        ]),
        nowMs,
      );

      assertEqual(normalized.activeCustomers.length, 3, 'partial one-customer queue pads to three slots');
      assertEqual(normalized.activeCustomers[2].status !== 'waiting', true, 'third slot can render refill action');
      assertEqual(canRefillCustomerBatch(normalized), true, 'one cleared loaded customer allows refill');

      const refill = refillCustomerBatch(normalized, nowMs + 100);
      assertEqual(refill.refilled, true, 'refill succeeds from padded one-customer queue');
      assertEqual(normalized.activeCustomers.length, 3, 'refill creates three customers');
      assertEqual(
        normalized.activeCustomers.every((customer) => customer.status === 'waiting'),
        true,
        'refill creates fresh waiting customers',
      );
    },
  },
  {
    name: 'save normalization pads two cleared loaded customers to a refillable three-slot queue',
    run: () => {
      const normalized = normalizeGameState(
        createRawStateWithCustomers([
          {
            instanceId: 'loaded-late-worker',
            customerId: 'late_worker',
            wantedExcuseIds: ['traffic_jam'],
            patienceRemainingMs: 0,
            createdAtMs: nowMs - 2_000,
            status: 'served',
          },
          {
            instanceId: 'loaded-missing-student',
            customerId: 'missing_student',
            wantedExcuseIds: ['just_saw_message'],
            patienceRemainingMs: 0,
            createdAtMs: nowMs - 1_000,
            status: 'left',
          },
        ]),
        nowMs,
      );

      assertEqual(normalized.activeCustomers.length, 3, 'partial two-customer queue pads to three slots');
      assertEqual(normalized.activeCustomers[2].status !== 'waiting', true, 'third slot can render refill action');
      assertEqual(canRefillCustomerBatch(normalized), true, 'two cleared loaded customers allow refill');

      const refill = refillCustomerBatch(normalized, nowMs + 100);
      assertEqual(refill.refilled, true, 'refill succeeds from padded two-customer queue');
      assertEqual(normalized.activeCustomers.length, 3, 'refill creates three customers');
      assertEqual(
        normalized.activeCustomers.every((customer) => customer.status === 'waiting'),
        true,
        'refill creates fresh waiting customers',
      );
    },
  },
  {
    name: 'save normalization keeps partial loaded queue unrefillable while any customer waits',
    run: () => {
      const normalized = normalizeGameState(
        createRawStateWithCustomers([
          {
            instanceId: 'loaded-late-worker',
            customerId: 'late_worker',
            wantedExcuseIds: ['traffic_jam'],
            patienceRemainingMs: 60_000,
            createdAtMs: nowMs,
            status: 'waiting',
          },
        ]),
        nowMs,
      );

      assertEqual(normalized.activeCustomers.length, 3, 'partial waiting queue pads to three slots');
      assertEqual(normalized.activeCustomers[0].status, 'waiting', 'loaded waiting customer persists');
      assertEqual(canRefillCustomerBatch(normalized), false, 'waiting loaded customer blocks refill');

      const refill = refillCustomerBatch(normalized, nowMs + 100);
      assertEqual(refill.refilled, false, 'refill is blocked while a loaded customer waits');
      assertEqual(normalized.activeCustomers[0].status, 'waiting', 'blocked refill preserves waiting customer');
    },
  },
  {
    name: 'dev save seeds create raw partial queues that normalize for browser QA',
    run: () => {
      assertEqual(devSaveSeedDefinitions.length, 5, 'all dev QA seeds are listed');

      const oneInactive = createDevSaveSeed('partial_one_inactive', nowMs);
      assertEqual(Object.keys(oneInactive.state.activeCrafts).length, 0, 'one inactive seed has no active crafts');
      assertEqual(oneInactive.state.activeCustomers.length, 1, 'one inactive seed writes a raw partial queue');
      assertEqual(oneInactive.state.activeCustomers[0].status, 'served', 'one inactive seed is cleared');
      const oneInactiveLoaded = normalizeSavedGame(oneInactive, nowMs);
      assertEqual(oneInactiveLoaded.activeCustomers.length, 3, 'one inactive seed loads into three slots');
      assertEqual(canRefillCustomerBatch(oneInactiveLoaded), true, 'one inactive seed loads refillable');

      const twoInactive = createDevSaveSeed('partial_two_inactive', nowMs);
      assertEqual(Object.keys(twoInactive.state.activeCrafts).length, 0, 'two inactive seed has no active crafts');
      assertEqual(twoInactive.state.activeCustomers.length, 2, 'two inactive seed writes a raw partial queue');
      const twoInactiveLoaded = normalizeSavedGame(twoInactive, nowMs);
      assertEqual(twoInactiveLoaded.activeCustomers.length, 3, 'two inactive seed loads into three slots');
      assertEqual(canRefillCustomerBatch(twoInactiveLoaded), true, 'two inactive seed loads refillable');

      const oneWaiting = createDevSaveSeed('partial_one_waiting', nowMs);
      assertEqual(Object.keys(oneWaiting.state.activeCrafts).length, 0, 'one waiting seed has no active crafts');
      assertEqual(oneWaiting.state.activeCustomers.length, 1, 'one waiting seed writes a raw partial queue');
      assertEqual(oneWaiting.state.activeCustomers[0].status, 'waiting', 'one waiting seed keeps a waiting customer');
      const oneWaitingLoaded = normalizeSavedGame(oneWaiting, nowMs);
      assertEqual(oneWaitingLoaded.activeCustomers.length, 3, 'one waiting seed loads into three slots');
      assertEqual(canRefillCustomerBatch(oneWaitingLoaded), false, 'one waiting seed still blocks refill');
    },
  },
  {
    name: 'dev progress seed includes coins, stock, served customer, and upgrade',
    run: () => {
      const progress = createDevSaveSeed('progress', nowMs);

      assertEqual(progress.state.currencies.coins, 125, 'progress seed coins');
      assertEqual(progress.state.currencies.smoothness, 4, 'progress seed smoothness');
      assertEqual(progress.state.excuseStock.traffic_jam, 2, 'progress seed traffic stock');
      assertEqual(progress.state.excuseStock.battery_dead, 1, 'progress seed battery stock');
      assertEqual(progress.state.excuseStock.just_saw_message, 3, 'progress seed message stock');
      assertEqual(progress.state.upgrades.bigger_shelf, 1, 'progress seed bought shelf upgrade');
      assertEqual(progress.state.activeCustomers[0].status, 'served', 'progress seed has a served customer');
      assertEqual(progress.state.activeCustomers[0].servedReward?.consumedExcuseId, 'traffic_jam', 'progress seed records consumed excuse');
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

function createRawStateWithCustomers(activeCustomers: unknown[]) {
  return {
    currencies: { coins: 0, smoothness: 0 },
    currentZoneId: 'daily_life',
    excuseStock: {},
    activeCustomers,
    customerBatchNumber: 0,
    upgrades: {},
    unlockedZoneIds: ['daily_life'],
    lastUpdatedAtMs: nowMs,
  };
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
