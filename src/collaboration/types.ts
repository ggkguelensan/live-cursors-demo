import type { RelativePosition } from 'yjs';

export const userIds = ['maya', 'leo', 'nora'] as const;
export type UserId = (typeof userIds)[number];
export type ViewerId = 'maya' | 'leo';
export type Profile = { id: UserId; name: string; color: string; avatarSrc: string; role: string };
export const profiles: Profile[] = [
  {
    id: 'maya',
    name: 'Maya Chen',
    color: '#7956d6',
    avatarSrc: '/avatars/maya.svg',
    role: 'Writing the first draft',
  },
  {
    id: 'leo',
    name: 'Leo Martín',
    color: '#1b8b81',
    avatarSrc: '/avatars/leo.svg',
    role: 'Reading and refining',
  },
  {
    id: 'nora',
    name: 'Nora Brooks',
    color: '#d37832',
    avatarSrc: '/avatars/nora.svg',
    role: 'Adding context',
  },
];
export type Anchor = RelativePosition;
export type Selection = { from: number; to: number };
export type Comment = {
  text: string;
  editing: boolean;
  expiresAt: number | null;
  simulated?: boolean;
};
export type Presence = {
  userId: UserId;
  session: string;
  sequence: number;
  updatedAt: number;
  anchor: Anchor;
  head: Anchor;
  comment: Comment | null;
};
export type Tag = { id: string; userId: UserId; label: string; start: Anchor; end: Anchor };
export type VisibleTag = Selection & Pick<Tag, 'id' | 'label' | 'userId'>;
export type Placement = Selection & {
  version: number;
  textVersion: number;
  pending: boolean;
  comment: Comment | null;
};
export type DocumentSnapshot = {
  session: string;
  version: number;
  textVersion: number;
  text: string;
  selection: Selection;
  tags: VisibleTag[];
};
export type Perspective = {
  document: DocumentSnapshot;
  people: Partial<Record<UserId, Placement>>;
};
export type Frame = {
  session: string;
  now: number;
  users: Profile[];
  views: Record<ViewerId, Perspective>;
  pending: number;
  held: boolean;
  playing: boolean;
  finished: boolean;
  converged: boolean;
  narrative: string;
  log: { id: number; text: string; kind: 'edit' | 'presence' | 'tag' | 'network' | 'comment' }[];
};
export type DocumentInput = {
  session: string;
  baseVersion: number;
  text: string;
  selection: Selection;
};
export type UserCommand =
  | ({ type: 'edit'; userId: ViewerId } & DocumentInput)
  | ({ type: 'select'; userId: ViewerId } & DocumentInput)
  | { type: 'tag'; userId: ViewerId }
  | { type: 'comment.start'; userId: ViewerId }
  | { type: 'comment.change'; userId: ViewerId; text: string }
  | { type: 'comment.stop'; userId: ViewerId }
  | { type: 'play' | 'hold' | 'deliver' | 'race' | 'reset' };
export const initialText =
  'A shared space for small ideas.\n\nWe are drafting this note together.\nKeep the draft short, clear and kind.\n\nEvery cursor has a point of view.';
