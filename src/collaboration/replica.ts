import * as Y from 'yjs';
import type { Comment, Presence, Selection, Tag, UserId, VisibleTag } from './types';

const remote = Symbol('remote');
const index = (value: number, length: number) => Math.max(0, Math.min(length, value));
export function relative(text: Y.Text, at: number, assoc = -1) {
  return Y.createRelativePositionFromTypeIndex(text, index(at, text.length), assoc);
}
function absolute(doc: Y.Doc, at: Y.RelativePosition): number | null {
  const position = Y.createAbsolutePositionFromRelativePosition(at, doc);
  return position?.type === doc.getText('document') ? position.index : null;
}
export function spliceDiff(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  // Avoid splitting a UTF-16 surrogate pair at either boundary.
  if (start && /[\uDC00-\uDFFF]/.test(before[start] ?? after[start] ?? '')) start--;
  if (oldEnd < before.length && /[\uDC00-\uDFFF]/.test(before[oldEnd])) oldEnd++;
  if (newEnd < after.length && /[\uDC00-\uDFFF]/.test(after[newEnd])) newEnd++;
  return { start, remove: oldEnd - start, insert: after.slice(start, newEnd) };
}

type CachedState = { text: string; state: Uint8Array; vector: Uint8Array };
export class Replica {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('document');
  readonly tags = this.doc.getMap<Tag>('tags');
  readonly presence = new Map<UserId, Presence>();
  readonly cache = new Map<number, CachedState>();
  revision = 0;
  sequence = 0;
  own: Presence;

  constructor(
    readonly userId: UserId,
    readonly session: string,
    seed: Uint8Array,
    private readonly sendUpdate: (update: Uint8Array) => void,
    private readonly sendPresence: (presence: Presence) => void,
    private readonly changed: () => void,
    private readonly clock: () => number = () => 0,
  ) {
    Y.applyUpdate(this.doc, seed, remote);
    this.own = {
      userId,
      session,
      sequence: 0,
      updatedAt: this.clock(),
      anchor: relative(this.text, 0),
      head: relative(this.text, 0),
      comment: null,
    };
    this.presence.set(userId, this.own);
    this.remember();
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.revision++;
      this.remember();
      if (origin !== remote) this.sendUpdate(update.slice());
      this.changed();
    });
  }
  private remember() {
    this.cache.set(this.revision, {
      text: this.text.toString(),
      state: Y.encodeStateAsUpdate(this.doc),
      vector: Y.encodeStateVector(this.doc),
    });
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
  }
  receiveUpdate(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, remote);
  }
  receivePresence(presence: Presence) {
    if (
      presence.session !== this.session ||
      (this.presence.get(presence.userId)?.sequence ?? -1) >= presence.sequence
    )
      return false;
    this.presence.set(presence.userId, presence);
    this.changed();
    return true;
  }
  selection(presence = this.own): Selection | null {
    const from = absolute(this.doc, presence.anchor);
    const to = absolute(this.doc, presence.head);
    return from === null || to === null
      ? null
      : { from: Math.min(from, to), to: Math.max(from, to) };
  }
  private publish(
    anchor = this.own.anchor,
    head = this.own.head,
    comment = this.own.comment,
    force = false,
  ) {
    if (
      !force &&
      this.sequence > 0 &&
      JSON.stringify([anchor, head, comment]) ===
        JSON.stringify([this.own.anchor, this.own.head, this.own.comment])
    )
      return;
    this.own = {
      userId: this.userId,
      session: this.session,
      sequence: ++this.sequence,
      updatedAt: this.clock(),
      anchor,
      head,
      comment,
    };
    this.presence.set(this.userId, this.own);
    this.sendPresence(this.own);
    this.changed();
  }
  move(from: number, to = from) {
    this.publish(relative(this.text, from), relative(this.text, to));
  }
  announce() {
    this.publish(this.own.anchor, this.own.head, this.own.comment, true);
  }

  edit(baseVersion: number, nextText: string, selection: Selection) {
    const base = this.cache.get(baseVersion);
    if (!base || nextText.length > 12000) return false;
    // Generate the edit against exactly the state the user saw, then CRDT-merge
    // with any newer remote updates. Never overwrite a newer document snapshot.
    const branch = new Y.Doc();
    try {
      Y.applyUpdate(branch, base.state);
      const text = branch.getText('document');
      const change = spliceDiff(base.text, nextText);
      branch.transact(() => {
        if (change.remove) text.delete(change.start, change.remove);
        if (change.insert) text.insert(change.start, change.insert);
      });
      const anchor = relative(text, selection.from);
      const head = relative(text, selection.to);
      Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(branch, base.vector), 'local-input');
      this.publish(anchor, head);
      return true;
    } finally {
      branch.destroy();
    }
  }
  select(baseVersion: number, displayedText: string, selection: Selection) {
    let base = this.cache.get(baseVersion);
    if (base?.text !== displayedText)
      base = [...this.cache.values()].reverse().find((state) => state.text === displayedText);
    if (!base) return;
    const branch = new Y.Doc();
    try {
      Y.applyUpdate(branch, base.state);
      const text = branch.getText('document');
      this.publish(relative(text, selection.from), relative(text, selection.to));
    } finally {
      branch.destroy();
    }
  }
  addTag(label = 'Keep this') {
    const range = this.selection();
    if (!range || range.from === range.to) return false;
    const id = `${this.userId}-${this.doc.clientID}-${++this.sequence}`;
    this.tags.set(id, {
      id,
      userId: this.userId,
      label,
      start: relative(this.text, range.from, 0),
      end: relative(this.text, range.to, -1),
    });
    return true;
  }
  comment(text: string, editing: boolean, now: number) {
    const comment: Comment | null =
      text || editing
        ? { text: text.slice(0, 180), editing, expiresAt: editing ? null : now + 30000 }
        : null;
    this.publish(this.own.anchor, this.own.head, comment);
  }
  expireComment(now: number) {
    if (this.own.comment?.expiresAt != null && this.own.comment.expiresAt <= now)
      this.publish(this.own.anchor, this.own.head, null);
  }
  visibleTags(): VisibleTag[] {
    return [...this.tags.values()]
      .flatMap((tag) => {
        const from = absolute(this.doc, tag.start);
        const to = absolute(this.doc, tag.end);
        return from !== null && to !== null && from < to
          ? [{ id: tag.id, userId: tag.userId, label: tag.label, from, to }]
          : [];
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  destroy() {
    this.doc.destroy();
    this.cache.clear();
    this.presence.clear();
  }
}
