import { useLayoutEffect, useState, type CSSProperties } from 'react';
import type { Profile, VisibleTag } from '../collaboration/types';
import { useGeometry, type Rect } from './geometry';

export function TagsView({ tags, users }: { tags: VisibleTag[]; users: Profile[] }) {
  const layout = useGeometry();
  const [marks, setMarks] = useState<{ tag: VisibleTag; rects: Rect[] }[]>([]);
  useLayoutEffect(() => {
    setMarks(tags.map((tag) => ({ tag, rects: layout.measure(tag)?.selection ?? [] })));
  }, [tags, layout]);
  return (
    <>
      {marks.flatMap(({ tag, rects }) =>
        rects.map((rect, index) => (
          <span
            key={`${tag.id}-${index}`}
            className="text-tag"
            title={tag.label}
            style={
              {
                left: rect.x,
                top: rect.y + rect.height - 3,
                width: rect.width,
                '--tag-color': users.find((user) => user.id === tag.userId)?.color ?? '#777',
              } as CSSProperties
            }
          />
        )),
      )}
    </>
  );
}
