import { createEffect, createEvent, createStore, sample } from 'effector';
import { DemoRoom } from './collaboration/room';
import {
  initialText,
  type DocumentSnapshot,
  type Frame,
  type UserCommand,
  type ViewerId,
} from './collaboration/types';

const emptyDocument: DocumentSnapshot = {
  session: 'loading',
  version: 0,
  textVersion: 0,
  text: initialText,
  selection: { from: 0, to: 0 },
  tags: [],
};
const initial: Frame = {
  session: 'loading',
  now: 0,
  users: [],
  views: {
    maya: { document: emptyDocument, people: {} },
    leo: { document: emptyDocument, people: {} },
  },
  pending: 0,
  held: false,
  playing: true,
  finished: false,
  converged: true,
  narrative: 'Connecting the simulated clients…',
  log: [],
};

export function createDemoModel() {
  const opened = createEvent<DemoRoom>();
  const closed = createEvent<DemoRoom>();
  const received = createEvent<{ room: DemoRoom; frame: Frame }>();
  const committed = createEvent<Frame>();
  const command = createEvent<UserCommand>();
  const focusRequested = createEvent<ViewerId>();
  // A network resource, not a React API. It is never serialized or shared across Scopes.
  const $room = createStore<DemoRoom | null>(null, { serialize: 'ignore' })
    .on(opened, (_, room) => room)
    .on(closed, (current, room) => (current === room ? null : current));
  const $frame = createStore(initial).on(committed, (_, frame) => frame);
  sample({
    clock: received,
    source: $room,
    filter: (room, message) => room === message.room && room?.session === message.frame.session,
    fn: (_, message) => message.frame,
    target: committed,
  });
  const invokeFx = createEffect(({ room, action }: { room: DemoRoom; action: UserCommand }) =>
    room.command(action),
  );
  sample({
    clock: command,
    source: $room,
    filter: (room): room is DemoRoom => room !== null,
    fn: (room, action) => ({ room: room!, action }),
    target: invokeFx,
  });
  sample({
    clock: command,
    filter: (action): action is Extract<UserCommand, { type: 'comment.stop' }> =>
      action.type === 'comment.stop',
    fn: (action: Extract<UserCommand, { type: 'comment.stop' }>) => action.userId,
    target: focusRequested,
  });
  return { opened, closed, received, committed, command, focusRequested, $frame };
}
export const model = createDemoModel();
