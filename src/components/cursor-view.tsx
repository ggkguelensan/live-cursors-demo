import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import type { Placement } from '../collaboration/types';
import { useGeometry, type Geometry, type Rect } from './geometry';
import { arrangeComments } from './comment-layout';

export type CursorHandle = { move(placement: Placement): void };
type Props = {
  userId: string;
  commentPeers: { id: string; placement: Placement }[];
  events: Ref<CursorHandle>;
  placement: Placement | null;
  name: string;
  color: string;
  avatarSrc: string;
  own: boolean;
  now: number;
  onCommentChange(text: string): void;
  onCommentStop(): void;
};
export function CursorView({
  userId,
  commentPeers,
  events,
  placement,
  name,
  color,
  avatarSrc,
  own,
  now,
  onCommentChange,
  onCommentStop,
}: Props) {
  const layout = useGeometry();
  const latest = useRef(placement);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const paint = (next: Placement | null) => {
    if (!next || next.pending || next.textVersion !== layout.textVersion) {
      setGeometry(null);
      return;
    }
    setGeometry(layout.measure(next));
  };
  useImperativeHandle(events, () => ({
    move(next) {
      if (!latest.current || next.version >= latest.current.version) {
        latest.current = next;
        paint(next);
      }
    },
  }));
  useLayoutEffect(() => {
    if (!latest.current || (placement && placement.version >= latest.current.version))
      latest.current = placement;
    paint(latest.current);
  }, [placement, layout]);
  const comment = placement?.comment;
  const editing = own && Boolean(comment?.editing) && !comment?.simulated;
  const visibleComment = Boolean(
    comment && (comment.expiresAt === null || comment.expiresAt > now),
  );
  const anchors = geometry
    ? commentPeers.flatMap(({ id, placement: peer }) => {
        if (peer.pending || peer.textVersion !== layout.textVersion) return [];
        const measured = layout.measure(peer);
        return measured
          ? [
              {
                id,
                x: measured.caret.x,
                y: measured.caret.y,
                text: peer.comment?.text ?? '',
                editing: peer.comment?.editing ?? false,
              },
            ]
          : [];
      })
    : [];
  const allocated = geometry
    ? arrangeComments(anchors, geometry.width, geometry.height)[userId]
    : undefined;
  const retained = useRef<Rect>({ x: 0, y: 0, width: 152, height: 102 });
  useLayoutEffect(() => {
    if (allocated) retained.current = allocated;
  }, [allocated]);
  const expanded = visibleComment && Boolean(allocated);
  const wasExpanded = useRef(expanded);
  const [animating, setAnimating] = useState(false);
  useLayoutEffect(() => {
    if (editing) commentInput.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    setAnimating(true);
    const timeout = setTimeout(() => setAnimating(false), 240);
    return () => clearTimeout(timeout);
  }, [expanded]);
  if (!geometry || !placement) return null;
  const bubble = allocated ?? retained.current;
  const avatarX = expanded ? bubble.x + bubble.width - 14 - geometry.caret.x : -1;
  const avatarY = expanded ? bubble.y - 14 - geometry.caret.y : -30;
  const connectionX = Math.max(
    bubble.x + 8,
    Math.min(geometry.caret.x + 1, bubble.x + bubble.width - 8),
  );
  const tether = `M ${geometry.caret.x + 1} ${geometry.caret.y - 2} L ${connectionX} ${bubble.y + bubble.height}`;
  return (
    <div
      className={`cursor-layer ${own ? 'is-own' : ''}`}
      data-comment-open={expanded}
      data-animating={animating}
      style={{ '--cursor-color': color } as CSSProperties}
      data-user={name}
    >
      {geometry.selection.map((rect, index) => (
        <div
          className="remote-selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          key={index}
        />
      ))}
      <svg className="comment-tether" aria-hidden="true" width="100%" height="100%">
        <path d={tether} />
      </svg>
      <div
        className="cursor-anchor"
        style={{ transform: `translate(${geometry.caret.x}px, ${geometry.caret.y}px)` }}
      >
        <div className="cursor-stem" style={{ height: geometry.caret.height }} />
        <div
          className={`cursor-comment ${editing ? 'is-editing' : ''}`}
          aria-hidden={!expanded}
          data-open={expanded}
          style={
            {
              left: bubble.x - geometry.caret.x,
              top: bubble.y - geometry.caret.y,
              width: bubble.width,
              height: bubble.height,
              '--comment-origin-x': `${geometry.caret.x - bubble.x}px`,
              '--comment-origin-y': `${geometry.caret.y - bubble.y}px`,
              '--comment-scale-x': 28 / bubble.width,
              '--comment-scale-y': 28 / bubble.height,
            } as CSSProperties
          }
        >
          {expanded && comment && (
            <div className="comment-content">
              {editing ? (
                <>
                  <textarea
                    ref={commentInput}
                    aria-label={`Comment as ${name}`}
                    value={comment.text}
                    placeholder="A thought, not a document edit…"
                    maxLength={180}
                    rows={2}
                    style={{ height: bubble.height - 40 }}
                    onChange={(event) => onCommentChange(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        onCommentStop();
                      }
                    }}
                  />
                  <div className="comment-hint">
                    <kbd>esc</kbd> back to document
                  </div>
                </>
              ) : (
                <>
                  <p>{comment.text || '…'}</p>
                  <div className="comment-hint comment-lifetime">
                    {comment.editing
                      ? 'typing…'
                      : `${Math.max(1, Math.ceil(((comment.expiresAt ?? now) - now) / 1000))}s`}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div
          className="cursor-avatar-position"
          style={{ transform: `translate(${avatarX}px, ${avatarY}px)` }}
        >
          <div
            className={`cursor-badge ${expanded || geometry.caret.x > geometry.width - 130 ? 'is-reversed' : ''}`}
            tabIndex={0}
            role="img"
            aria-label={`${name}${own ? ' (you)' : ''}`}
          >
            <img src={avatarSrc} alt="" width={24} height={24} />
            <span className="cursor-name">
              {name.split(' ')[0]}
              {own ? ' · you' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
