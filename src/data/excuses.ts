import type { ExcuseDefinition, ExcuseId } from '../types/game';

export const excuses: Record<ExcuseId, ExcuseDefinition> = {
  traffic_jam: {
    id: 'traffic_jam',
    displayName: 'รถติด',
    shortLabel: 'รถติด',
    description: 'ข้ออ้างคลาสสิกสำหรับความล่าช้าทุกชนิด',
    starter: true,
    baseValue: 10,
    maxStock: 5,
  },
  battery_dead: {
    id: 'battery_dead',
    displayName: 'แบตหมด',
    shortLabel: 'แบตหมด',
    description: 'ใช้เมื่อหายเงียบและต้องการความน่าเชื่อถือ',
    starter: true,
    baseValue: 12,
    maxStock: 5,
  },
  just_saw_message: {
    id: 'just_saw_message',
    displayName: 'เพิ่งเห็นข้อความ',
    shortLabel: 'เพิ่งเห็น',
    description: 'เหมาะกับแชทที่ถูกดองไว้แบบไม่ตั้งใจ',
    starter: true,
    baseValue: 15,
    maxStock: 5,
  },
};

export const starterExcuseIds: ExcuseId[] = ['traffic_jam', 'battery_dead', 'just_saw_message'];
