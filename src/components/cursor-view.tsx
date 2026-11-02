import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import type { Placement } from '../collaboration/types';
import { useGeometry, type Geometry } from './geometry';
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
  const editing = own && Boolean(comment?.editing);
  useLayoutEffect(() => {
    if (editing) commentInput.current?.focus();
  }, [editing]);
  if (!geometry || !placement) return null;
  const visibleComment = comment && (comment.expiresAt === null || comment.expiresAt > now);
  const anchors = commentPeers.flatMap(({ id, placement: peer }) => {
    if (peer.pending || peer.textVersion !== layout.textVersion) return [];
    const measured = layout.measure(peer);
    return measured ? [{ id, x: measured.caret.x, y: measured.caret.y }] : [];
  });
  const bubble = arrangeComments(anchors, geometry.width, geometry.height)[userId];
  return (
    <div
      className={`cursor-layer ${own ? 'is-own' : ''}`}
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
      <div
        className="cursor-anchor"
        style={{ transform: `translate(${geometry.caret.x}px, ${geometry.caret.y}px)` }}
      >
        <div className="cursor-stem" style={{ height: geometry.caret.height }} />
        <div
          className="cursor-badge"
          style={
            geometry.caret.x > geometry.width - 130
              ? { left: 'auto', right: 0, transform: 'translate(2px, -2px)' }
              : undefined
          }
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
        {visibleComment && bubble && (
          <div
            className={`cursor-comment ${editing ? 'is-editing' : ''}`}
            style={{
              left: bubble.x - geometry.caret.x,
              top: bubble.y - geometry.caret.y,
              width: bubble.width,
              transform: 'none',
            }}
          >
            <div className="comment-author">
              {name.split(' ')[0]}{' '}
              <span>
                {comment.editing
                  ? 'writing a thought'
                  : `${Math.max(1, Math.ceil(((comment.expiresAt ?? now) - now) / 1000))}s`}
              </span>
            </div>
            {editing ? (
              <>
                <textarea
                  ref={commentInput}
                  aria-label={`Comment as ${name}`}
                  value={comment.text}
                  placeholder="A thought, not a document edit…"
                  maxLength={180}
                  rows={2}
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
                  <kbd>esc</kbd> to return · stays for 30s
                </div>
              </>
            ) : (
              <p>{comment.text || '…'}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
