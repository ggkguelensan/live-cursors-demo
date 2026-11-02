import { reflect } from '@effector/reflect';
import { withImperativeEvents } from '@effector/reflect/imperative';
import { model } from './model';
import { profiles, userIds, type ViewerId, type DocumentInput } from './collaboration/types';
import { CursorView } from './components/cursor-view';
import { DocumentView } from './components/document-view';
import { TagsView } from './components/tags-view';

function perspective(viewer: ViewerId) {
  const $commentPeers = model.$frame.map((frame) =>
    userIds.flatMap((id) => {
      const placement = frame.views[viewer].people[id];
      return placement?.comment ? [{ id, placement }] : [];
    }),
  );
  const Cursors = userIds.map((userId) => {
    const ReflectedCursor = reflect({
      view: CursorView,
      bind: {
        userId,
        commentPeers: $commentPeers,
        name: model.$frame.map(
          (frame) => frame.users.find((user) => user.id === userId)?.name ?? '',
        ),
        color: model.$frame.map(
          (frame) => frame.users.find((user) => user.id === userId)?.color ?? '#777',
        ),
        avatarSrc: model.$frame.map(
          (frame) => frame.users.find((user) => user.id === userId)?.avatarSrc ?? '',
        ),
        placement: model.$frame.map((frame) => frame.views[viewer].people[userId] ?? null),
        now: model.$frame.map((frame) => frame.now),
        own: userId === viewer,
        onCommentChange: model.command.prepend((text: string) => ({
          type: 'comment.change' as const,
          userId: viewer,
          text,
        })),
        onCommentStop: model.command.prepend(() => ({
          type: 'comment.stop' as const,
          userId: viewer,
        })),
      },
    });
    return withImperativeEvents({
      move: model.committed.filterMap((frame) => frame.views[viewer].people[userId]),
    })(ReflectedCursor);
  });
  const Tags = reflect({
    view: TagsView,
    bind: {
      tags: model.$frame.map((frame) => frame.views[viewer].document.tags),
      users: model.$frame.map((frame) => frame.users),
    },
  });
  const ReflectedDocument = reflect({
    view: DocumentView,
    bind: {
      snapshot: model.$frame.map((frame) => frame.views[viewer].document),
      label: `${profiles.find((user) => user.id === viewer)!.name.split(' ')[0]}'s document`,
      onEdit: model.command.prepend((input: DocumentInput) => ({
        ...input,
        type: 'edit' as const,
        userId: viewer,
      })),
      onSelect: model.command.prepend((input: DocumentInput) => ({
        ...input,
        type: 'select' as const,
        userId: viewer,
      })),
      onComment: model.command.prepend(() => ({ type: 'comment.start' as const, userId: viewer })),
    },
  });
  const Document = withImperativeEvents({
    sync: model.committed.map((frame) => frame.views[viewer].document),
    focus: model.focusRequested.filter({ fn: (userId) => userId === viewer }),
  })(ReflectedDocument);
  return function ConnectedDocument() {
    return (
      <Document>
        <Tags />
        {Cursors.map((Cursor, index) => (
          <Cursor key={userIds[index]} />
        ))}
      </Document>
    );
  };
}
export const MayaDocument = perspective('maya');
export const LeoDocument = perspective('leo');
