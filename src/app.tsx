import { fork } from 'effector';
import { Provider, useUnit } from 'effector-react';
import { useEffect } from 'react';
import { DemoRoom } from './collaboration/room';
import type { UserId, ViewerId } from './collaboration/types';
import { MayaDocument, LeoDocument } from './bindings';
import { model } from './model';

const scope = fork();
function Room() {
  const { frame, command, opened, closed, received } = useUnit({
    frame: model.$frame,
    command: model.command,
    opened: model.opened,
    closed: model.closed,
    received: model.received,
  });
  useEffect(() => {
    const room = new DemoRoom((frame) => received({ room, frame }));
    opened(room);
    room.start();
    return () => {
      room.destroy();
      closed(room);
    };
  }, [opened, closed, received]);
  const user = (id: UserId) => frame.users.find((profile) => profile.id === id);
  const panel = (id: ViewerId) => {
    const profile = user(id);
    const Document = id === 'maya' ? MayaDocument : LeoDocument;
    const tags = frame.views[id].document.tags;
    return (
      <section
        className="perspective"
        aria-label={`${id === 'maya' ? 'Maya' : 'Leo'}’s perspective`}
      >
        <header className="perspective-header">
          <div className="identity">
            {profile && <img src={profile.avatarSrc} alt="" />}
            <div>
              <strong>{profile?.name ?? 'Connecting…'}</strong>
              <span>{id === 'maya' ? 'Perspective 01' : 'Perspective 02'}</span>
            </div>
          </div>
          <span className="local-label">
            <i /> LOCAL CLIENT
          </span>
        </header>
        <div className="document-toolbar">
          <span className="document-title">A note on working together</span>
          <span className="document-format">
            Aa <span>·</span> Plain text
          </span>
        </div>
        <Document />
        <div className="panel-actions">
          <button onClick={() => command({ type: 'comment.start', userId: id })}>
            <span>◌</span> Cursor comment <kbd>⌘ /</kbd>
          </button>
          <button onClick={() => command({ type: 'tag', userId: id })}>
            <span>⌑</span> Tag selection
          </button>
          <span className="char-count">{frame.views[id].document.text.length} chars</span>
        </div>
        <div className="tag-list">
          <span className="eyebrow">TEXT TAGS</span>
          {tags.length ? (
            tags.map((tag) => (
              <span className="tag-chip" key={tag.id}>
                <i style={{ background: user(tag.userId)?.color }} />
                {tag.label}
                <small>{frame.views[id].document.text.slice(tag.from, tag.to)}</small>
              </span>
            ))
          ) : (
            <span className="empty-tags">Select a phrase to give it a little context.</span>
          )}
        </div>
      </section>
    );
  };
  const synced = frame.converged && frame.pending === 0;
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="https://github.com/ggkguelensan/live-cursors-demo">
          <span className="brand-mark">↗↙</span> side by side
          <span className="brand-divider" />
          <span className="brand-subtitle">a live cursor lab</span>
        </a>
        <a
          className="source-link"
          href="https://github.com/ggkguelensan/live-cursors-demo"
          target="_blank"
          rel="noreferrer"
        >
          View source ↗
        </a>
      </header>
      <div className="intro">
        <div>
          <span className="eyebrow">A SMALL EXPERIMENT IN SHARED PRESENCE</span>
          <h1>
            Same words.
            <br />
            <em>Different points of view.</em>
          </h1>
          <p>
            Two independent clients, one shared document. Watch the collaborators respond to each
            other—or step into either side and join in.
          </p>
        </div>
        <div className="roster">
          {frame.users.map((profile) => (
            <div className="roster-person" key={profile.id}>
              <img src={profile.avatarSrc} alt="" />
              <i style={{ background: profile.color }} />
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lab-controls">
        <div className={`sync-status ${synced ? 'is-synced' : ''}`} role="status">
          <i />
          {synced ? 'All replicas agree' : frame.held ? 'Deliveries held' : 'Syncing changes'}
          <span>{frame.pending} packets in flight</span>
        </div>
        <div className="control-buttons">
          <button
            className="primary-button"
            onClick={() => command({ type: frame.finished ? 'reset' : 'play' })}
          >
            {frame.finished
              ? '↺ Reset and replay'
              : frame.playing
                ? 'Ⅱ Pause collaborators'
                : '▷ Run collaborators'}
          </button>
          <button aria-pressed={frame.held} onClick={() => command({ type: 'hold' })}>
            {frame.held ? 'Resume network' : 'Hold network'}
          </button>
          <button onClick={() => command({ type: 'deliver' })} disabled={frame.pending === 0}>
            Deliver in reverse
          </button>
          <button onClick={() => command({ type: 'race' })}>Race two edits</button>
          <button
            className="icon-button"
            aria-label="Reset demo"
            onClick={() => command({ type: 'reset' })}
          >
            ↺
          </button>
        </div>
      </div>
      <div className="story-caption">
        <span className="live-dot" />
        {frame.narrative}
      </div>
      <div className="perspectives" key={frame.session}>
        {panel('maya')}
        {panel('leo')}
      </div>
      <div className="lab-bottom">
        <section className="activity">
          <div className="section-heading">
            <span className="eyebrow">WHAT JUST HAPPENED</span>
            <span>Simulated network · delayed & duplicated packets</span>
          </div>
          <ol>
            {frame.log.length ? (
              [...frame.log]
                .reverse()
                .slice(0, 5)
                .map((entry) => (
                  <li key={entry.id}>
                    <span className={`activity-kind ${entry.kind}`}>{entry.kind}</span>
                    {entry.text}
                  </li>
                ))
            ) : (
              <li className="waiting">The room is open. The first thought is on its way.</li>
            )}
          </ol>
        </section>
        <aside className="how-to">
          <span className="eyebrow">A THOUGHT ABOVE THE TEXT</span>
          <p>
            Press <kbd>⌘</kbd> <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>/</kbd> while editing. Your
            words appear in your cursor bubble. <kbd>esc</kbd> brings you back; the thought stays
            for 30 seconds.
          </p>
          <small>
            Yjs merges document edits. Relative anchors keep cursors and tags attached. Effector +
            Reflect deliver data and imperative events to React.
          </small>
        </aside>
      </div>
      <footer>
        <span>Built for the moments between the keystrokes.</span>
        <span>React · Effector · Reflect · Yjs</span>
      </footer>
    </main>
  );
}
export function App() {
  return (
    <Provider value={scope}>
      <Room />
    </Provider>
  );
}
