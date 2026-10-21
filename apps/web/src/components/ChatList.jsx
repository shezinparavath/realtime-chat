import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { otherParticipant, useChats } from '../chats/ChatsContext.jsx';
import { badgeText, unreadLabel } from '../chats/unread.js';
import { chatPath } from '../router.js';
import { Avatar } from './Avatar.jsx';
import { StaleNotice } from './Field.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { SlowState } from './SlowState.jsx';
import { StateBlock } from './StateBlock.jsx';
import { formatListTime } from './time.js';

/**
 * GET /chats list, sorted updatedAt desc (A-4). Live-updated from `message:new` via the store.
 * Preview: one line, CSS ellipsis, full text from the server (ruling P3-7); "No messages yet" for
 * lastMessage null (ruling P3-8).
 */
export function ChatList({ suppressSlow = false, selectedChatId = null, hidden = false }) {
  const { user } = useAuth();
  const { sortedChats, listState, loadChats, unread, online } = useChats();

  useEffect(() => {
    loadChats({ background: listState.status === 'ok' }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showLoading = listState.status === 'loading' && sortedChats.length === 0;
  const slowShown = listState.slow && !suppressSlow;
  // RTC-UI-06: while the search box has text, the results replace the list (spec §7.2). The list
  // stays mounted (hidden), so its state, live updates and the desktop selection are kept.
  return (
    <section className="card chats-card" aria-labelledby="chats-title" hidden={hidden} data-testid="chats-section">
      <h2 id="chats-title" className="sr-only">
        Chats
      </h2>
      {listState.status === 'ok' && listState.stale && <StaleNotice onRetry={() => loadChats({ background: true })} testId="chats-stale" />}
      {showLoading && (
        <>
          {/* Spec §2A: skeleton rows before 4 s. Once slow, the one SlowState replaces them (Jain, UI-05);
              when another pane's SlowState wins, the rows still go. The rows are aria-hidden; only the
              polite status / SlowState is announced (once). */}
          <SlowState show={slowShown} variant="block" />
          {!slowShown && (
            <p className="sr-only" role="status" data-testid="chats-loading">
              Loading chats…
            </p>
          )}
          {!listState.slow && <SkeletonRows count={3} />}
        </>
      )}
      {listState.status === 'error' && (
        <StateBlock role="alert" title="Couldn't load chats." body={listState.error} actionLabel="Retry" onAction={() => loadChats().catch(() => {})} testId="chats-error" />
      )}
      {listState.status === 'ok' && sortedChats.length === 0 && (
        <StateBlock title="No chats yet" body="Search for a username above to start a conversation." testId="chats-empty" />
      )}
      {sortedChats.length > 0 && (
        <ul className="chat-list" data-testid="chat-list">
          {sortedChats.map((c) => {
            const other = otherParticipant(c, user?.id);
            const last = c.lastMessage;
            const selected = c.id === selectedChatId; // RTC-UI-03: desktop selected row
            const isOnline = !!other?.id && online.has(other.id); // RTC-N1-05
            const count = selected ? 0 : unread[c.id] || 0; // RTC-N1-03 (the open chat never shows one)
            return (
              <li key={c.id}>
                <a
                  href={`#${chatPath(c.id)}`}
                  className={`chat-row${selected ? ' selected' : ''}`}
                  aria-current={selected ? 'page' : undefined}
                  data-testid={`chat-row-${other?.username}`}
                >
                  <Avatar user={other} size={40} online={isOnline} />
                  <span className="chat-row-body">
                    <span className="chat-row-top">
                      <span className="username">
                        @{other?.username ?? 'unknown'}
                        {isOnline && <span className="sr-only">, online</span>}
                      </span>
                      <span className="time" data-testid="chat-time">
                        {formatListTime(c.updatedAt)}
                      </span>
                    </span>
                    <span className="chat-row-bottom">
                      <span className={`preview${last ? '' : ' empty'}`} data-testid="chat-preview">
                        {last ? `${last.senderId === user?.id ? 'You: ' : ''}${last.text}` : 'No messages yet'}
                      </span>
                      {count > 0 && (
                        <span className="unread-badge" data-testid="unread-badge" data-count={count}>
                          <span aria-hidden="true">{badgeText(count)}</span>
                          <span className="sr-only">, {unreadLabel(count)}</span>
                        </span>
                      )}
                    </span>
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
