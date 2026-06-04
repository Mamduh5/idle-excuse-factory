import type { CustomerDefinition } from '../types/game';

export const customers: CustomerDefinition[] = [
  {
    id: 'late_worker',
    displayName: 'พนักงานมาสาย',
    problemText: 'ต้องเข้าประชุม แต่ยังไม่ถึงออฟฟิศ',
    wantedExcuseIds: ['traffic_jam'],
    coinMultiplier: 1,
    patienceSeconds: 60,
    smoothnessReward: 1,
  },
  {
    id: 'missing_student',
    displayName: 'นักเรียนลืมงาน',
    problemText: 'การบ้านอยู่ที่ไหนสักแห่งในจักรวาล',
    wantedExcuseIds: ['just_saw_message'],
    coinMultiplier: 1,
    patienceSeconds: 55,
    smoothnessReward: 1,
  },
  {
    id: 'ghost_texter',
    displayName: 'คนตอบแชทช้า',
    problemText: 'ต้องตอบกลับโดยไม่ดูน่าสงสัยเกินไป',
    wantedExcuseIds: ['battery_dead', 'just_saw_message'],
    coinMultiplier: 1,
    patienceSeconds: 50,
    smoothnessReward: 2,
  },
];
