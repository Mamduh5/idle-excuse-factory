import type { CustomerDefinition } from '../types/game';

export const customers: CustomerDefinition[] = [
  {
    id: 'late_worker',
    displayName: 'พนักงานมาสาย',
    problemText: 'ต้องเข้าประชุม แต่ยังไม่ถึงออฟฟิศ',
    wantedExcuseId: 'traffic_jam',
    baseRewardCoins: 10,
    baseRewardSmoothness: 1,
  },
  {
    id: 'missing_student',
    displayName: 'นักเรียนลืมงาน',
    problemText: 'การบ้านอยู่ที่ไหนสักแห่งในจักรวาล',
    wantedExcuseId: 'battery_dead',
    baseRewardCoins: 12,
    baseRewardSmoothness: 1,
  },
  {
    id: 'ghost_texter',
    displayName: 'คนตอบแชทช้า',
    problemText: 'ต้องตอบกลับโดยไม่ดูน่าสงสัยเกินไป',
    wantedExcuseId: 'just_saw_message',
    baseRewardCoins: 15,
    baseRewardSmoothness: 2,
  },
];
