import {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import type { DocumentSnapshot, DocumentInput, Selection } from '../collaboration/types';
import { GeometryContext, type Geometry, type Rect } from './geometry';

export type DocumentHandle = { sync(snapshot: DocumentSnapshot): void; focus(): void };
type Props = {
  snapshot: DocumentSnapshot;
  label: string;
  events: Ref<DocumentHandle>;
  onEdit(input: DocumentInput): void;
  onSelect(input: DocumentInput): void;
  onComment(): void;
  children: ReactNode;
};

export function DocumentView({
  snapshot,
  label,
  events,
  onEdit,
  onSelect,
  onComment,
  children,
}: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const pending = useRef(snapshot);
  const composing = useRef(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [composingText, setComposingText] = useState<string | null>(null);
  const compositionBase = useRef(snapshot);
  const finishedComposition = useRef<string | null>(null);

  useImperativeHandle(events, () => ({
    sync(next) {
      if (next.version >= pending.current.version) pending.current = next;
    },
    focus() {
      textarea.current?.focus();
    },
  }));
  useLayoutEffect(() => {
    if (snapshot.version >= pending.current.version) pending.current = snapshot;
    const field = textarea.current;
    if (!field || composing.current) return;
    // Only use a selection resolved against the text that is actually committed.
    const next = pending.current;
    if (
      next.textVersion === snapshot.textVersion &&
      (field.selectionStart !== next.selection.from || field.selectionEnd !== next.selection.to)
    )
      field.setSelectionRange(next.selection.from, next.selection.to);
  }, [snapshot.textVersion]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field || !mirror.current) return;
    const resize = () => {
      if (mirror.current) mirror.current.style.width = `${field.clientWidth}px`;
      setLayoutVersion((value) => value + 1);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(field);
    document.fonts?.addEventListener('loadingdone', resize);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', resize);
    };
  }, []);
  const layout = useMemo(
    () => ({
      textVersion: snapshot.textVersion,
      measure(range: Selection): Geometry | null {
        const node = mirror.current?.firstChild;
        const bounds = canvas.current?.getBoundingClientRect();
        if (!node || !bounds || range.from < 0 || range.to > snapshot.text.length) return null;
        const selection = document.createRange();
        if (typeof selection.getClientRects !== 'function') return null;
        const local = (rect: DOMRect): Rect => ({
          x: rect.left - bounds.left,
          y: rect.top - bounds.top,
          width: rect.width,
          height: rect.height || 30,
        });
        selection.setStart(node, range.from);
        selection.setEnd(node, range.to);
        const rects = [...selection.getClientRects()].map(local).filter((rect) => rect.width > 0);
        selection.setStart(node, range.to);
        selection.setEnd(node, Math.min(range.to + 1, snapshot.text.length + 1));
        const caret = local(selection.getBoundingClientRect());
        return {
          caret: { ...caret, width: 2 },
          selection: range.from === range.to ? [] : rects,
          width: bounds.width,
          height: bounds.height,
        };
      },
    }),
    [snapshot.textVersion, snapshot.text, layoutVersion],
  );
  const input = (field: HTMLTextAreaElement, base = snapshot): DocumentInput => ({
    session: base.session,
    baseVersion: base.textVersion,
    text: field.value,
    selection: { from: field.selectionStart, to: field.selectionEnd },
  });
  return (
    <GeometryContext.Provider value={layout}>
      <div className="document-canvas" ref={canvas} data-composing={composingText !== null}>
        <div className="text-mirror document-text" ref={mirror} aria-hidden="true">
          {snapshot.text + '\u200b'}
        </div>
        <textarea
          className="document-input document-text"
          ref={textarea}
          aria-label={label}
          value={composingText ?? snapshot.text}
          spellCheck={false}
          maxLength={12000}
          onCompositionStart={() => {
            composing.current = true;
            compositionBase.current = snapshot;
            setComposingText(textarea.current!.value);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            finishedComposition.current = event.currentTarget.value;
            onEdit(input(event.currentTarget, compositionBase.current));
            setComposingText(null);
          }}
          onChange={(event) => {
            if (composing.current) {
              setComposingText(event.currentTarget.value);
              return;
            }
            if (finishedComposition.current === event.currentTarget.value) {
              finishedComposition.current = null;
              return;
            }
            finishedComposition.current = null;
            onEdit(input(event.currentTarget));
          }}
          onSelect={(event) => {
            if (!composing.current) onSelect(input(event.currentTarget));
          }}
          onScroll={(event) => {
            if (mirror.current)
              mirror.current.style.transform = `translate(${-event.currentTarget.scrollLeft}px, ${-event.currentTarget.scrollTop}px)`;
            setLayoutVersion((value) => value + 1);
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              (event.code === 'Slash' || event.key === '/') &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onComment();
            }
          }}
        />
        <div className="document-overlays">{children}</div>
      </div>
    </GeometryContext.Provider>
  );
}
