# Idle Excuse Factory — UI Mockup Pack

Place this folder in your repository at:

```text
docs/ui-mockups/
```

This pack is a visual handoff for the first mobile UI direction of **Idle Excuse Factory / โรงงานข้ออ้าง**. It is not game code. Codex can use these files later as reference when building `FactoryScene` and the Phaser UI views.

## Files

```text
01-main-factory-mobile-390x844.svg
02-upgrades-modal-mobile-390x844.svg
03-offline-earnings-popup-mobile-390x844.svg
04-layout-map-390x844.svg
index.html
IMPLEMENTATION_NOTES.md
```

## Intended first UI scope

The first implementation should create a mobile portrait UI with:

- top HUD for Coins, ความเนียน, and Zone
- customer queue with 3 slots
- excuse counter with starter stock cards
- craft panel with 3 production buttons
- footer actions: Upgrades, Zones, Archive, Settings
- modal overlay behavior for panels

## Design direction

- Warm beige factory background
- Rounded cards and buttons
- Cute Thai doodle mood
- Big readable Thai text
- Clear section hierarchy
- Main gameplay always visible

## Target viewports

```text
390x844 primary
360x640 compact test
```

For 360x640, reduce descriptions and padding before shrinking important text too much.

## How to preview

Open `index.html` in a browser, or open the `.svg` files directly.
