import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { DemoRoom } from '../src/collaboration/room';
import { Replica, spliceDiff } from '../src/collaboration/replica';
import { initialText, type Presence } from '../src/collaboration/types';

function room() {
  const room = new DemoRoom(() => {});
  room.playing = false;
  room.drain();
  return room;
}
const texts = (room: DemoRoom) =>
  Object.values(room.replicas).map((replica) => replica.text.toString());

describe('concurrent editing', () => {
  test('two independent inserts survive reverse-order and duplicate delivery', () => {
    const demo = room();
    try {
      demo.held = true;
      for (const userId of ['maya', 'leo'] as const) {
        const replica = demo.replicas[userId];
        demo.command({
          type: 'edit',
          session: demo.session,
          userId,
          baseVersion: replica.revision,
          text: `${userId.toUpperCase()} ${initialText}`,
          selection: { from: 5, to: 5 },
        });
      }
      expect(texts(demo)[0]).not.toBe(texts(demo)[1]);
      demo.drain('reverse');
      expect(new Set(texts(demo)).size).toBe(1);
      expect(texts(demo)[0]).toContain('MAYA');
      expect(texts(demo)[0]).toContain('LEO');
      expect(demo.snapshot().converged).toBe(true);
    } finally {
      demo.destroy();
    }
  });
  test('input based on an older rendered state does not overwrite unseen remote edits', () => {
    const demo = room();
    try {
      const maya = demo.replicas.maya;
      const oldVersion = maya.revision;
      const leo = demo.replicas.leo;
      leo.edit(leo.revision, 'REMOTE ' + initialText, { from: 7, to: 7 });
      demo.drain();
      expect(maya.text.toString()).toContain('REMOTE');
      maya.edit(oldVersion, initialText.replace('small', 'brave'), { from: 12, to: 12 });
      demo.drain('reverse');
      expect(new Set(texts(demo)).size).toBe(1);
      expect(maya.text.toString()).toContain('REMOTE');
      expect(maya.text.toString()).toContain('brave ideas');
      expect(maya.text.toString()).not.toContain('small ideas');
    } finally {
      demo.destroy();
    }
  });
  test('expired input snapshots are rejected instead of silently overwriting current text', () => {
    const demo = room();
    try {
      const replica = demo.replicas.maya;
      const old = replica.revision;
      for (let index = 0; index < 70; index++)
        replica.edit(replica.revision, replica.text.toString() + '.', { from: 0, to: 0 });
      const current = replica.text.toString();
      expect(replica.edit(old, 'stale replacement', { from: 0, to: 0 })).toBe(false);
      expect(replica.text.toString()).toBe(current);
    } finally {
      demo.destroy();
    }
  });
});

test('presence received before its referenced text stays unresolved, then rebases; stale presence is ignored', () => {
  const seed = new Y.Doc();
  seed.getText('document').insert(0, 'abc');
  const updates: Uint8Array[] = [];
  const presences: Presence[] = [];
  const left = new Replica(
    'maya',
    'session',
    Y.encodeStateAsUpdate(seed),
    (update) => updates.push(update),
    (value) => presences.push(value),
    () => {},
  );
  const right = new Replica(
    'leo',
    'session',
    Y.encodeStateAsUpdate(seed),
    () => {},
    () => {},
    () => {},
  );
  try {
    left.move(2);
    const old = presences[0];
    left.edit(left.revision, 'XYabc', { from: 1, to: 1 });
    const latest = presences.at(-1)!;
    expect(right.receivePresence(latest)).toBe(true);
    expect(right.selection(latest)).toBeNull();
    for (const update of updates) right.receiveUpdate(update);
    expect(right.selection(latest)).toEqual({ from: 1, to: 1 });
    expect(right.receivePresence(old)).toBe(false);
    expect(right.presence.get('maya')?.sequence).toBe(latest.sequence);
    expect(right.receivePresence({ ...latest, session: 'another session', sequence: 100 })).toBe(
      false,
    );
  } finally {
    left.destroy();
    right.destroy();
    seed.destroy();
  }
});

test('tags follow prefix insertion and disappear when their entire range is deleted', () => {
  const demo = room();
  try {
    const at = initialText.indexOf('small');
    demo.replicas.nora.move(at, at + 5);
    demo.replicas.nora.addTag('Keep');
    demo.drain();
    const maya = demo.replicas.maya;
    maya.edit(maya.revision, 'Prefix ' + maya.text.toString(), { from: 0, to: 0 });
    demo.drain('reverse');
    for (const replica of Object.values(demo.replicas)) {
      expect(replica.visibleTags()[0].from).toBe(at + 7);
      const tag = replica.visibleTags()[0];
      expect(replica.text.toString().slice(tag.from, tag.to)).toBe('small');
    }
    const leo = demo.replicas.leo;
    const tag = leo.visibleTags()[0];
    leo.edit(
      leo.revision,
      leo.text.toString().slice(0, tag.from) + leo.text.toString().slice(tag.to),
      { from: tag.from, to: tag.from },
    );
    demo.drain('reverse');
    expect(
      Object.values(demo.replicas).every((replica) => replica.visibleTags().length === 0),
    ).toBe(true);
  } finally {
    demo.destroy();
  }
});

test('cursor comments never edit text and remain for precisely 30 seconds after Escape', () => {
  const demo = room();
  try {
    demo.command({ type: 'comment.start', userId: 'maya' });
    demo.command({ type: 'comment.change', userId: 'maya', text: 'A thought outside the text.' });
    demo.command({ type: 'comment.stop', userId: 'maya' });
    demo.drain('reverse');
    expect(texts(demo)).toEqual([initialText, initialText, initialText]);
    expect(demo.snapshot().views.leo.people.maya?.comment?.text).toBe(
      'A thought outside the text.',
    );
    demo.advance(29999);
    expect(demo.snapshot().views.maya.people.maya?.comment?.text).toBeTruthy();
    demo.advance(1);
    expect(demo.snapshot().views.maya.people.maya?.comment).toBeNull();
    expect(demo.snapshot().views.leo.people.maya?.comment).toBeNull();
    expect(texts(demo)).toEqual([initialText, initialText, initialText]);
  } finally {
    demo.destroy();
  }
});

test('collaborators react to delivered edits and converge after the whole scenario', () => {
  const demo = new DemoRoom(() => {});
  try {
    for (let index = 0; index < 100; index++) demo.advance(250);
    demo.drain('reverse');
    expect(demo.playing).toBe(false);
    expect(new Set(texts(demo)).size).toBe(1);
    expect(texts(demo)[0]).toContain('live shared');
    expect(texts(demo)[0]).toContain('Keep the note short, clear.');
    expect(demo.replicas.maya.visibleTags().length).toBe(1);
    expect(demo.log.some((entry) => entry.text.includes('after reading'))).toBe(true);
  } finally {
    demo.destroy();
  }
});

test('a reset discards in-flight packets from the old room state', () => {
  const demo = room();
  try {
    demo.command({ type: 'race' });
    demo.command({ type: 'reset' });
    demo.playing = false;
    demo.drain('reverse');
    expect(texts(demo)).toEqual([initialText, initialText, initialText]);
    expect(demo.snapshot().pending).toBe(0);
  } finally {
    demo.destroy();
  }
});

test.each([
  ['🟣x', '🟢x'],
  ['a😀b', 'aZ😀b'],
  ['a😀b', 'ab'],
  ['hello', 'hello!'],
  ['abc', ''],
])('UTF-16 splice reconstructs %s → %s', (before, after) => {
  const change = spliceDiff(before, after);
  expect(
    before.slice(0, change.start) + change.insert + before.slice(change.start + change.remove),
  ).toBe(after);
});

test('deleting from an older snapshot preserves concurrently inserted characters inside that range', () => {
  const seed = new Y.Doc();
  seed.getText('document').insert(0, 'abc');
  const updates: Uint8Array[] = [];
  const left = new Replica(
    'maya',
    'session',
    Y.encodeStateAsUpdate(seed),
    () => {},
    () => {},
    () => {},
  );
  const right = new Replica(
    'leo',
    'session',
    Y.encodeStateAsUpdate(seed),
    (update) => updates.push(update),
    () => {},
    () => {},
  );
  try {
    const base = left.revision;
    right.edit(right.revision, 'aXbc', { from: 2, to: 2 });
    for (const update of updates) left.receiveUpdate(update);
    // The local user selected the old 'abc', not the unseen remote X.
    left.edit(base, '', { from: 0, to: 0 });
    expect(left.text.toString()).toBe('X');
  } finally {
    left.destroy();
    right.destroy();
    seed.destroy();
  }
});

test('stale presence leases hide disconnected cursors and presence buffering stays bounded', () => {
  const demo = room();
  try {
    demo.held = true;
    for (let index = 0; index < 40; index++) demo.advance(1000);
    const frame = demo.snapshot();
    expect(frame.views.maya.people.leo?.pending).toBe(true);
    expect(frame.views.maya.people.maya?.pending).toBe(false);
    expect(demo.queue.length).toBeLessThanOrEqual(6);
    demo.held = false;
    demo.drain('reverse');
    expect(demo.snapshot().views.maya.people.leo?.pending).toBe(false);
  } finally {
    demo.destroy();
  }
});

test('a reset rejects stale input and even retained old packet callbacks', () => {
  const demo = room();
  try {
    const oldSession = demo.session;
    demo.replicas.maya.edit(demo.replicas.maya.revision, 'An old document', { from: 0, to: 0 });
    const retainedPackets = demo.queue.map((packet) => packet.run);
    demo.command({ type: 'reset' });
    demo.playing = false;
    for (const run of retainedPackets) run();
    demo.command({
      type: 'edit',
      session: oldSession,
      userId: 'maya',
      baseVersion: 0,
      text: 'Expired input',
      selection: { from: 0, to: 0 },
    });
    demo.drain('reverse');
    expect(demo.session).not.toBe(oldSession);
    expect(texts(demo)).toEqual([initialText, initialText, initialText]);
  } finally {
    demo.destroy();
  }
});
