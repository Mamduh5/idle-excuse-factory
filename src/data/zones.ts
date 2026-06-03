import type { ZoneDefinition } from '../types/game';

export const zones: ZoneDefinition[] = [
  {
    id: 'daily_life',
    displayName: 'Daily Life',
    description: 'ปัญหาประจำวัน งานเรียน แชท และเรื่องสาย',
    unlockedByDefault: true,
  },
  {
    id: 'office_zone',
    displayName: 'Office Zone',
    description: 'ข้ออ้างประชุม งานด่วน และอีเมลที่หายไป',
    unlockRequirementText: 'ต้องการ 50 ความเนียน',
    unlockedByDefault: false,
  },
];
