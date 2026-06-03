export type CurrencyState = {
  coins: number;
  smoothness: number;
};

export type ExcuseId = 'traffic_jam' | 'battery_dead' | 'just_saw_message';

export type ExcuseDefinition = {
  id: ExcuseId;
  displayName: string;
  shortLabel: string;
  description: string;
  starter: boolean;
  baseValue: number;
  maxStock: number;
};

export type ExcuseStock = Record<ExcuseId, number>;

export type CustomerDefinition = {
  id: string;
  displayName: string;
  problemText: string;
  wantedExcuseIds: ExcuseId[];
  coinMultiplier: number;
  smoothnessReward: number;
};

export type CustomerInstance = {
  instanceId: string;
  customerId: CustomerDefinition['id'];
  wantedExcuseIds: ExcuseId[];
  patienceRemainingMs: number;
  createdAtMs: number;
  status: 'waiting' | 'served';
  servedAtMs?: number;
  servedReward?: {
    coins: number;
    smoothness: number;
    consumedExcuseId: ExcuseId;
  };
};

export type UpgradeDefinition = {
  id: string;
  displayName: string;
  description: string;
  costCoins: number;
  maxLevel: number;
};

export type UpgradeState = Record<UpgradeDefinition['id'], number>;

export type ZoneDefinition = {
  id: string;
  displayName: string;
  description: string;
  unlockRequirementText?: string;
  unlockedByDefault: boolean;
};

export type GameState = {
  currencies: CurrencyState;
  currentZoneId: ZoneDefinition['id'];
  excuseStock: ExcuseStock;
  activeCustomers: CustomerInstance[];
  customerBatchNumber: number;
  upgrades: UpgradeState;
  unlockedZoneIds: ZoneDefinition['id'][];
  lastUpdatedAtMs: number;
};

export type SaveDataV1 = {
  version: 1;
  savedAtMs: number;
  lastActiveAtMs: number;
  state: GameState;
};
