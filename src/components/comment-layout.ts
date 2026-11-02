import type { Rect } from './geometry';

// At most three participants in this lab. Keep bubbles inside the viewport and
// separate them without moving the actual document cursors or their anchors.
export function arrangeComments(
  anchors: { id: string; x: number; y: number }[],
  width: number,
  height: number,
): Record<string, Rect> {
  const bubbleWidth = Math.min(220, anchors.length > 1 ? (width - 36) / 2 : width - 24);
  const bubbleHeight = 110;
  const result: Record<string, Rect> = {};
  const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + 8 &&
    a.x + a.width + 8 > b.x &&
    a.y < b.y + b.height + 8 &&
    a.y + a.height + 8 > b.y;
  for (const anchor of anchors) {
    const preferredX = Math.max(12, Math.min(anchor.x + 7, width - bubbleWidth - 12));
    const preferredY = anchor.y > bubbleHeight + 45 ? anchor.y - bubbleHeight - 40 : anchor.y + 35;
    const candidates: Rect[] = [];
    const neighboringRows = Object.values(result).flatMap((rect) => [
      rect.y + rect.height + 12,
      rect.y - bubbleHeight - 12,
    ]);
    for (const y of [preferredY, 10, 132, 254, ...neighboringRows]) {
      for (const x of [preferredX, 12, width - bubbleWidth - 12]) {
        if (y >= 8 && y + bubbleHeight <= height - 8)
          candidates.push({ x, y, width: bubbleWidth, height: bubbleHeight });
      }
    }
    candidates.sort((a, b) => {
      const score = (rect: Rect) =>
        Object.values(result).filter((other) => intersects(rect, other)).length * 1e6 +
        (rect.x - preferredX) ** 2 +
        (rect.y - preferredY) ** 2;
      return score(a) - score(b);
    });
    result[anchor.id] = candidates[0] ?? { x: 12, y: 10, width: bubbleWidth, height: bubbleHeight };
  }
  return result;
}
