import * as Y from 'yjs';
import { Replica } from './replica';
import {
  initialText,
  profiles,
  userIds,
  type Frame,
  type Presence,
  type UserCommand,
  type UserId,
  type ViewerId,
} from './types';

type Message =
  | { type: 'update'; session: string; from: UserId; update: Uint8Array }
  | { type: 'presence'; session: string; from: UserId; presence: Presence };
type Packet = { id: number; due: number; key?: string; run(): void };
let roomNumber = 0;
export class DemoRoom {
  private readonly roomId = ++roomNumber;
  private epoch = 0;
  get session() {
    return `room-${this.roomId}:${this.epoch}`;
  }
  server = new Y.Doc();
  replicas = {} as Record<UserId, Replica>;
  now = 0;
  held = false;
  playing = true;
  narrative = 'Three people, one document. Watch a small idea become a shared one.';
  users = profiles;
  queue: Packet[] = [];
  log: Frame['log'] = [];
  private packetId = 0;
  private frameId = 0;
  private logId = 0;
  private storyStep = 0;
  private nextStory = 1500;
  private lastSecond = 0;
  private lastHeartbeat = 0;
  private releaseRace: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private booting = true;
  private knownUsers = new Map<UserId, typeof profiles>();
  private presenceClock = new Map<UserId, number>();

  constructor(private readonly onFrame: (frame: Frame) => void) {
    this.initialize();
  }
  private initialize() {
    this.booting = true;
    this.server.getText('document').insert(0, initialText);
    const seed = Y.encodeStateAsUpdate(this.server);
    const session = this.session;
    for (const userId of userIds) {
      this.replicas[userId] = new Replica(
        userId,
        this.session,
        seed,
        (update) => this.send({ type: 'update', session, from: userId, update }),
        (presence) => this.send({ type: 'presence', session, from: userId, presence }),
        () => this.emit(),
        () => this.now,
      );
    }
    // Roster is a separate server message, not an inferred list of cursors.
    for (const userId of userIds)
      this.enqueue(() => {
        this.knownUsers.set(userId, profiles);
        this.emit();
      });
    this.replicas.maya.move(9);
    this.replicas.leo.move(31);
    this.replicas.nora.move(initialText.indexOf('small'), initialText.indexOf('small') + 11);
    this.booting = false;
  }
  start() {
    this.emit();
    let previous = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.advance(now - previous);
      previous = now;
    }, 50);
  }
  private enqueue(run: () => void, duplicate = false, key?: string) {
    if (key) this.queue = this.queue.filter((packet) => packet.key !== key);
    const id = ++this.packetId;
    const delay = [240, 90, 420, 150, 310][id % 5];
    this.queue.push({ id, due: this.now + delay, key, run });
    if (duplicate) this.queue.push({ id: ++this.packetId, due: this.now + delay + 180, key, run });
  }
  private send(message: Message) {
    if (this.disposed) return;
    this.enqueue(
      () => {
        if (message.session !== this.session) return;
        if (message.type === 'update') Y.applyUpdate(this.server, message.update, 'network');
        else {
          if (
            message.presence.session !== this.session ||
            (this.presenceClock.get(message.from) ?? -1) >= message.presence.sequence
          )
            return;
          this.presenceClock.set(message.from, message.presence.sequence);
        }
        for (const to of userIds) {
          if (to === message.from) continue;
          this.enqueue(
            () => {
              if (message.session !== this.session) return;
              if (message.type === 'update') this.replicas[to].receiveUpdate(message.update);
              else this.replicas[to].receivePresence(message.presence);
            },
            this.packetId % 4 === 0,
            message.type === 'presence' ? `${message.from}:${to}:presence` : undefined,
          );
        }
      },
      this.packetId % 5 === 0,
      message.type === 'presence' ? `${message.from}:server:presence` : undefined,
    );
    this.emit();
  }
  advance(milliseconds: number) {
    if (this.disposed) return;
    this.now += Math.max(0, milliseconds);
    if (!this.held) {
      const ready = this.queue
        .filter((packet) => packet.due <= this.now)
        .sort((a, b) => a.due - b.due || a.id - b.id);
      const ids = new Set(ready.map((packet) => packet.id));
      this.queue = this.queue.filter((packet) => !ids.has(packet.id));
      for (const packet of ready) packet.run();
      if (ready.length) this.emit();
    }
    for (const replica of Object.values(this.replicas)) replica.expireComment(this.now);
    if (this.releaseRace !== null && this.now >= this.releaseRace) {
      this.releaseRace = null;
      this.held = false;
      this.drain('reverse');
      this.note('network', 'Replay complete. Both edits survive, including duplicate packets.');
    }
    if (this.playing && this.now >= this.nextStory) {
      this.nextStory = this.now + 1800;
      this.story();
    }
    if (this.now - this.lastHeartbeat >= 5000) {
      this.lastHeartbeat = this.now;
      for (const replica of Object.values(this.replicas)) replica.announce();
    }
    if (Math.floor(this.now / 1000) !== this.lastSecond) {
      this.lastSecond = Math.floor(this.now / 1000);
      if (Object.values(this.replicas).some((replica) => replica.own.comment)) this.emit();
    }
  }
  drain(order: 'forward' | 'reverse' = 'forward') {
    let delivered = 0;
    while (this.queue.length) {
      if (delivered++ > 10000) throw new Error('Network did not quiesce');
      const packet = order === 'reverse' ? this.queue.pop()! : this.queue.shift()!;
      packet.run();
    }
    this.emit();
  }
  private note(kind: Frame['log'][number]['kind'], text: string) {
    this.log = [...this.log, { id: ++this.logId, kind, text }].slice(-18);
    this.emit();
  }
  private rewrite(userId: UserId, from: number, remove: number, insert: string) {
    const replica = this.replicas[userId];
    const old = replica.text.toString();
    if (from < 0 || from > old.length || remove < 0 || from + remove > old.length) return;
    const next = old.slice(0, from) + insert + old.slice(from + remove);
    replica.edit(replica.revision, next, { from: from + insert.length, to: from + insert.length });
  }
  private story() {
    const maya = this.replicas.maya;
    const leo = this.replicas.leo;
    const nora = this.replicas.nora;
    const word = (replica: Replica, text: string) => replica.text.toString().indexOf(text);
    switch (this.storyStep) {
      case 0: {
        this.narrative = 'Maya adds “live”. The other clients have not received it yet.';
        this.rewrite('maya', word(maya, 'shared'), 0, 'live ');
        this.note('edit', 'Maya added “live” to the opening line.');
        break;
      }
      case 1: {
        const at = word(leo, 'live');
        if (at < 0) return;
        leo.move(at, at + 11);
        leo.comment('Love this direction. Let’s keep it simple.', true, this.now);
        this.narrative = 'Leo receives Maya’s edit, selects it and replies in his cursor bubble.';
        this.note('comment', 'Leo reacts to Maya’s new phrase with a cursor comment.');
        break;
      }
      case 2: {
        leo.comment(leo.own.comment?.text ?? '', false, this.now);
        const at = word(nora, 'live');
        if (at < 0) return;
        nora.move(at, at + 11);
        nora.addTag('Good direction');
        this.narrative = 'Nora tags the same phrase. Its anchors will follow later text edits.';
        this.note('tag', 'Nora tagged “live shared” as “Good direction”.');
        break;
      }
      case 3: {
        if (!maya.visibleTags().length) return;
        const draft = word(maya, 'the draft');
        if (draft < 0) return;
        maya.move(draft + 4, draft + 9);
        maya.comment('Leo, could you tighten this sentence?', false, this.now);
        this.narrative = 'Maya sees Nora’s tag and asks Leo to refine the draft.';
        this.note('comment', 'Maya asks Leo to tighten the sentence.');
        break;
      }
      case 4: {
        if (!leo.presence.get('maya')?.comment) return;
        const at = word(leo, 'the draft');
        if (at < 0) return;
        this.rewrite('leo', at + 4, 5, 'note');
        this.narrative =
          'Leo responds with an edit. Every cursor and tag is rebased against the merged text.';
        this.note('edit', 'Leo replaces “draft” with “note” after reading Maya’s comment.');
        break;
      }
      case 5: {
        if (word(nora, 'Keep the note') < 0) return;
        const at = word(nora, ' and kind');
        if (at >= 0) this.rewrite('nora', at, 9, '');
        nora.comment('A little shorter. Ready to share?', false, this.now);
        this.narrative =
          'Nora receives the revision, removes a few words and leaves a final thought.';
        this.note('edit', 'Nora shortens the sentence and leaves a 30-second comment.');
        break;
      }
      default:
        this.playing = false;
        this.narrative =
          'Your turn. Edit either view, leave a cursor comment, or race two concurrent edits.';
        this.emit();
        return;
    }
    this.storyStep++;
    this.emit();
  }
  command(command: UserCommand) {
    if (this.disposed) return;
    if ('session' in command && command.session !== this.session) {
      this.note('network', 'An input from a previous document session was ignored.');
      return;
    }
    if ('userId' in command) {
      const replica = this.replicas[command.userId];
      switch (command.type) {
        case 'edit':
          if (!replica.edit(command.baseVersion, command.text, command.selection))
            this.note('network', 'An expired input snapshot was rejected and refreshed.');
          break;
        case 'select':
          replica.select(command.baseVersion, command.text, command.selection);
          break;
        case 'tag':
          this.note(
            'tag',
            replica.addTag()
              ? `${command.userId} added a tag to the selected text.`
              : 'Select some text before adding a tag.',
          );
          break;
        case 'comment.start':
          replica.comment(replica.own.comment?.text ?? '', true, this.now);
          break;
        case 'comment.change':
          replica.comment(command.text, true, this.now);
          break;
        case 'comment.stop':
          replica.comment(replica.own.comment?.text ?? '', false, this.now);
          break;
      }
    } else
      switch (command.type) {
        case 'play':
          this.playing = !this.playing;
          this.nextStory = this.now + 500;
          break;
        case 'hold':
          this.held = !this.held;
          break;
        case 'deliver':
          this.held = false;
          this.drain('reverse');
          this.note('network', 'Queued packets delivered in reverse order, including duplicates.');
          break;
        case 'race': {
          this.playing = false;
          this.drain();
          this.held = true;
          const at = this.replicas.maya.text.toString().indexOf('ideas') + 5;
          this.rewrite('maya', Math.max(0, at), 0, ' + Maya');
          this.rewrite('leo', Math.max(0, at), 0, ' + Leo');
          this.releaseRace = this.now + 1000;
          this.narrative =
            'Two clients insert at the same position before either sees the other edit. Replay arrives out of order.';
          this.note('network', 'Race started: independent edits at the same anchor.');
          break;
        }
        case 'reset':
          this.reset();
          break;
      }
    this.emit();
  }
  private reset() {
    this.queue = [];
    this.epoch++;
    for (const replica of Object.values(this.replicas)) replica.destroy();
    this.server.destroy();
    this.server = new Y.Doc();
    this.presenceClock.clear();
    this.knownUsers.clear();
    this.log = [];
    this.storyStep = 0;
    this.nextStory = this.now + 1500;
    this.held = false;
    this.playing = true;
    this.releaseRace = null;
    this.narrative = 'A fresh document. Watch how the collaborators respond to one another.';
    this.initialize();
  }
  snapshot(): Frame {
    const version = ++this.frameId;
    const perspective = (viewer: ViewerId) => {
      const replica = this.replicas[viewer];
      const allowed = this.knownUsers.get(viewer) ?? [];
      return {
        document: {
          session: this.session,
          version,
          textVersion: replica.revision,
          text: replica.text.toString(),
          selection: replica.selection() ?? { from: 0, to: 0 },
          tags: replica.visibleTags(),
        },
        people: Object.fromEntries(
          allowed.map(({ id }) => {
            const presence = replica.presence.get(id);
            const range =
              presence && this.now - presence.updatedAt <= 15000
                ? replica.selection(presence)
                : null;
            const comment = presence?.comment;
            return [
              id,
              {
                version,
                textVersion: replica.revision,
                ...(range ?? { from: 0, to: 0 }),
                pending: !range,
                comment:
                  comment && (comment.expiresAt === null || comment.expiresAt > this.now)
                    ? comment
                    : null,
              },
            ];
          }),
        ),
      };
    };
    const states = Object.values(this.replicas).map((replica) =>
      JSON.stringify({ text: replica.text.toString(), tags: replica.visibleTags() }),
    );
    return {
      session: this.session,
      now: this.now,
      users: this.knownUsers.get('maya') ?? [],
      views: { maya: perspective('maya'), leo: perspective('leo') },
      pending: this.queue.length,
      held: this.held,
      playing: this.playing,
      finished: !this.playing && this.storyStep >= 6,
      converged:
        states.every((state) => state === states[0]) &&
        this.server.getText('document').toString() === this.replicas.maya.text.toString(),
      narrative: this.narrative,
      log: this.log,
    };
  }
  private emit() {
    if (!this.booting && !this.disposed) this.onFrame(this.snapshot());
  }
  destroy() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.queue = [];
    for (const replica of Object.values(this.replicas)) replica.destroy();
    this.server.destroy();
  }
}
