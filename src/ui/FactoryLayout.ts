import { clamp, type Rect } from '../utils/layout';

export type FactoryLayout = {
  screen: Rect;
  hud: Rect;
  title: Rect;
  customerQueue: Rect;
  excuseCounter: Rect;
  craftPanel: Rect;
  footer: Rect;
  gap: number;
  compact: boolean;
};

export function createFactoryLayout(width: number, height: number): FactoryLayout {
  const compact = height < 720;
  const outerMargin = clamp(Math.round(width * 0.035), 10, 16);
  const gap = compact ? 7 : 10;
  const contentWidth = width - outerMargin * 2;
  const hudHeight = clamp(Math.round(height * 0.085), 52, 72);
  const footerHeight = clamp(Math.round(height * 0.075), 52, 66);
  const titleHeight = compact ? 45 : 58;
  const y0 = outerMargin;
  const footerY = height - outerMargin - footerHeight;
  const bodyTop = y0 + hudHeight + gap + titleHeight + gap;
  const bodyBottom = footerY - gap;
  const bodyHeight = Math.max(0, bodyBottom - bodyTop);
  const queueHeight = Math.round(bodyHeight * (compact ? 0.35 : 0.36));
  const counterHeight = Math.round(bodyHeight * (compact ? 0.31 : 0.29));
  const craftHeight = Math.max(96, bodyHeight - queueHeight - counterHeight - gap * 2);

  return {
    screen: { x: 0, y: 0, width, height },
    hud: { x: outerMargin, y: y0, width: contentWidth, height: hudHeight },
    title: { x: outerMargin, y: y0 + hudHeight + gap, width: contentWidth, height: titleHeight },
    customerQueue: { x: outerMargin, y: bodyTop, width: contentWidth, height: queueHeight },
    excuseCounter: {
      x: outerMargin,
      y: bodyTop + queueHeight + gap,
      width: contentWidth,
      height: counterHeight,
    },
    craftPanel: {
      x: outerMargin,
      y: bodyTop + queueHeight + gap + counterHeight + gap,
      width: contentWidth,
      height: craftHeight,
    },
    footer: { x: outerMargin, y: footerY, width: contentWidth, height: footerHeight },
    gap,
    compact,
  };
}
