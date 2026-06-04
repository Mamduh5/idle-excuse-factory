import type { UpgradeDefinition } from '../types/game';

export const upgrades: UpgradeDefinition[] = [
  {
    id: 'bigger_shelf',
    displayName: 'ชั้นวางข้ออ้าง',
    description: 'เพิ่มที่เก็บข้ออ้างทุกแบบแบบไม่ต้องจัดระเบียบจริง',
    effectLabel: '+2 stock cap / level',
    costCoins: 60,
    costGrowth: 1.45,
    implemented: true,
    maxLevel: 5,
  },
  {
    id: 'premium_bullshit',
    displayName: 'Premium Bullshit',
    description: 'คำอธิบายฟังแพงขึ้น ลูกค้าเลยจ่ายเพิ่ม',
    effectLabel: '+10% coins / level',
    costCoins: 90,
    costGrowth: 1.5,
    implemented: true,
    maxLevel: 5,
  },
  {
    id: 'smoother_words',
    displayName: 'คำพูดเนียนขึ้น',
    description: 'เพิ่มความน่าเชื่อถือของข้ออ้างแบบหน้าตาย',
    effectLabel: '+1 ความเนียน / level',
    costCoins: 80,
    costGrowth: 1.45,
    implemented: true,
    maxLevel: 5,
  },
  {
    id: 'extra_printer',
    displayName: 'เครื่องพิมพ์ข้ออ้าง',
    description: 'จะเพิ่มสปีดผลิตเมื่อมีระบบจับเวลา',
    effectLabel: 'Soon',
    costCoins: 50,
    costGrowth: 1.4,
    implemented: false,
    maxLevel: 5,
  },
];
