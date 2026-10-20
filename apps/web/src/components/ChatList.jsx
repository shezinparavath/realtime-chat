import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { otherParticipant, useChats } from '../chats/ChatsContext.jsx';
import { chatPath } from '../router.js';
import { ErrorBlock, StaleNotice } from './Field.jsx';
import { SlowState } from './SlowState.jsx';
import { formatTime } from './time.js';

/**
 * GET /chats list, sorted updatedAt desc (A-4). Live-updated from `message:new` via the store.
 * Preview: one line, CSS ellipsis, full text from the server (ruling P3-7); "No messages yet" for
 * lastMessage null (ruling P3-8).
 */
export function ChatList({ suppressSlow = false }) {
  const { user } = useAuth();
  const { sortedChats, listState, loadChats } = useChats();

  useEffect(() => {
    loadChats({ background: listState.status === 'ok' }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showLoading = listState.status === 'loading' && sortedChats.length === 0;
  return (
    <section className="card" aria-labelledby="chats-title">
      <h2 id="chats-title">Chats</h2>
      {listState.status === 'ok' && listState.stale && <StaleNotice onRetry={() => loadChats({ background: true })} testId="chats-stale" />}
      {showLoading && (
        <>
          {/* RTC-UI-01: SlowState block above the loading placeholder after 4 s (skeleton rows: UI-06). */}
          <SlowState show={listState.slow && !suppressSlow} variant="block" />
          {!(listState.slow && !suppressSlow) && (
            <p className="muted" role="status" data-testid="chats-loading">
              Loading chats…
            </p>
          )}
        </>
      )}
      {listState.status === 'error' && (
        <ErrorBlock message={`Couldn't load chats. ${listState.error}`} onRetry={() => loadChats().catch(() => {})} testId="chats-error" />
      )}
      {listState.status === 'ok' && sortedChats.length === 0 && (
        <p className="muted" role="status" data-testid="chats-empty">
          No chats yet. Search for someone above to start one.
        </p>
      )}
      {sortedChats.length > 0 && (
        <ul className="chat-list" data-testid="chat-list">
          {sortedChats.map((c) => {
            const other = otherParticipant(c, user?.id);
            const last = c.lastMessage;
            return (
              <li key={c.id}>
                <a href={`#${chatPath(c.id)}`} className="chat-row" data-testid={`chat-row-${other?.username}`}>
                  <span className="chat-row-top">
                    <span className="username">@{other?.username ?? 'unknown'}</span>
                    <span className="muted time">{formatTime(c.updatedAt)}</span>
                  </span>
                  <span className={`preview${last ? '' : ' muted'}`} data-testid="chat-preview">
                    {last ? `${last.senderId === user?.id ? 'You: ' : ''}${last.text}` : 'No messages yet'}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
