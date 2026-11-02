import type { Rect } from './geometry';

type CommentAnchor = { id: string; x: number; y: number; text: string; editing: boolean };

// Prefer the caret as the lower-left corner of a growing container. Near edges
// or other comments, move its body; CursorView keeps a filled tether to the caret.
export function arrangeComments(
  anchors: CommentAnchor[],
  width: number,
  height: number,
): Record<string, Rect> {
  const result: Record<string, Rect> = {};
  const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + 20 &&
    a.x + a.width + 20 > b.x &&
    a.y < b.y + b.height + 20 &&
    a.y + a.height + 20 > b.y;
  for (const anchor of anchors) {
    const maximumWidth = Math.min(
      220,
      (width - 20 * (anchors.length + 1)) / Math.max(1, anchors.length),
    );
    const bubbleWidth = Math.min(
      maximumWidth,
      Math.max(anchor.editing ? 116 : 64, 28 + anchor.text.length * 6.1),
    );
    const charsPerLine = Math.max(12, Math.floor((bubbleWidth - 28) / 6.1));
    const lines = anchor.text
      .split('\n')
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
    const textHeight = Math.min(72, Math.max(18, lines * 18));
    const bubbleHeight = 40 + textHeight;
    const preferredX = Math.max(20, Math.min(anchor.x - 1, width - bubbleWidth - 20));
    const preferredY = anchor.y - bubbleHeight - 12;
    const candidates: Rect[] = [];
    const neighboringRows = Object.values(result).flatMap((rect) => [
      rect.y + rect.height + 24,
      rect.y - bubbleHeight - 24,
    ]);
    for (const y of [preferredY, 20, ...neighboringRows]) {
      const columns =
        anchors.length > 1
          ? Array.from(
              { length: anchors.length },
              (_, lane) => 20 + lane * ((width - 40 - maximumWidth) / (anchors.length - 1)),
            )
          : [preferredX];
      for (const x of columns) {
        if (y >= 20 && y + bubbleHeight <= Math.min(height - 20, anchor.y - 8))
          candidates.push({ x, y, width: bubbleWidth, height: bubbleHeight });
      }
    }
    const score = (rect: Rect) =>
      Object.values(result).filter((other) => intersects(rect, other)).length * 1e6 +
      (rect.x - preferredX) ** 2 +
      (rect.y - preferredY) ** 2;
    candidates.sort((a, b) => score(a) - score(b));
    result[anchor.id] = candidates[0] ?? { x: 20, y: 20, width: bubbleWidth, height: bubbleHeight };
  }
  return result;
}
