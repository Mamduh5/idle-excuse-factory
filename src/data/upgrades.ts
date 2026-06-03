import type { UpgradeDefinition } from '../types/game';

export const upgrades: UpgradeDefinition[] = [
  {
    id: 'extra_printer',
    displayName: 'เครื่องพิมพ์ข้ออ้าง',
    description: 'เพิ่มกำลังผลิตในอนาคต',
    costCoins: 50,
    maxLevel: 5,
  },
  {
    id: 'smoother_words',
    displayName: 'คำพูดเนียนขึ้น',
    description: 'เพิ่มความน่าเชื่อถือของข้ออ้างในอนาคต',
    costCoins: 80,
    maxLevel: 5,
  },
  {
    id: 'bigger_shelf',
    displayName: 'ชั้นวางข้ออ้าง',
    description: 'เพิ่มพื้นที่เก็บสต็อกข้ออ้างในอนาคต',
    costCoins: 120,
    maxLevel: 5,
  },
];
