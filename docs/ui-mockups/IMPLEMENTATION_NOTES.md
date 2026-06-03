# Idle Excuse Factory — UI Implementation Notes

## Recommended Phaser UI class mapping

```text
FactoryScene
  owns layout orchestration, scene update loop, modal state, saves, and callbacks

HudView
  renders Coins, ความเนียน, and current zone

CustomerQueueView
  renders 3 customer slots, problem text, wanted excuse, and later patience bars

ExcuseCounterView
  renders stock cards for รถติด, แบตหมด, เพิ่งเห็นข้อความ

CraftPanelView
  renders production buttons and button states

FooterActionBarView
  opens Upgrades, Zones, Archive, Settings panels

UpgradePanelView
  modal panel with buy buttons and insufficient-coin feedback

OfflineEarningsPopup
  modal shown after load when offline coins are awarded

ToastView
  short feedback messages such as เต็มแล้ว!, ยังมี coins ไม่พอ, ขายข้ออ้างสำเร็จ +10
```

## Layout regions for 390x844

```text
HUD: y 0-72
Title/status: y 88-145
Customer queue: y 150-370
Excuse counter: y 388-565
Craft panel: y 580-745
Footer: y 768-844
```

## Compact 360x640 rules

- Keep HUD and footer visible.
- Customer cards become shorter.
- Hide long descriptions inside excuse cards.
- Use shorter button labels where needed.
- Craft buttons must remain tappable.
- Do not hide the customer queue or craft panel behind a menu.

## Visual states Codex should support later

### Craft buttons

```text
Ready: ผลิต รถติด
Crafting: กำลังผลิต... 2s
Full: เต็มแล้ว
Locked: ปลดล็อก 120 coins
```

### Customer cards

```text
Waiting with enough patience
Low patience warning
Served reward feedback
Empty slot: รอลูกค้าคนต่อไป...
```

### Excuse stock cards

```text
Normal stock
Zero stock / empty visual state
Full stock
Locked excuse
```

### Panels

```text
Open panel dims background
Close button is obvious
Background input is blocked
Passive economy can keep running unless intentionally paused
```

## First UI acceptance criteria

```text
HUD visible
customer queue visible
excuse counter visible
craft buttons visible
footer visible
no overlap at 360x640
no overlap at 390x844
Thai text does not clip badly
buttons are tappable
panels block background input
```
