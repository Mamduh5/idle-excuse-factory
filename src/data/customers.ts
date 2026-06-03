import type { CustomerDefinition } from '../types/game';

export const customers: CustomerDefinition[] = [
  {
    id: 'late_worker',
    displayName: 'พนักงานมาสาย',
    problemText: 'ต้องเข้าประชุม แต่ยังไม่ถึงออฟฟิศ',
    wantedExcuseId: 'traffic_jam',
    coinMultiplier: 1,
    smoothnessReward: 1,
  },
  {
    id: 'missing_student',
    displayName: 'นักเรียนลืมงาน',
    problemText: 'การบ้านอยู่ที่ไหนสักแห่งในจักรวาล',
    wantedExcuseId: 'just_saw_message',
    coinMultiplier: 1,
    smoothnessReward: 1,
  },
  {
    id: 'ghost_texter',
    displayName: 'คนตอบแชทช้า',
    problemText: 'ต้องตอบกลับโดยไม่ดูน่าสงสัยเกินไป',
    wantedExcuseId: 'battery_dead',
    coinMultiplier: 1,
    smoothnessReward: 2,
  },
];
