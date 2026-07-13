// VibeNet — Contacts directory.
//
// A structured, searchable view of the people you have established conversations
// with. There is no backend "contacts" store (a DM is just two user IDs — see
// src/lib/conversations.ts), so contacts are derived from the same client-side
// conversation registry the sidebar DM list uses, and live online status comes
// from the WebSocket presence set (`onlinePeers`) DashboardShell polls.
//
// Selecting a contact routes back through DashboardShell.openPeer, which opens
// the room directly and bypasses the chat-PIN gate — these are already
// established contacts, so no re-verification is required.
//
// Presentation is Tailwind-first (premium SaaS chat aesthetic): a fixed frosted
// search header over a single scroll region of rounded, hover-lit contact rows,
// each with a circular avatar and a glowing presence badge.

'use client';

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { MessageCircle, Search, SearchX, Users, X } from 'lucide-react';
import { resolveAvatarUrl } from '@/lib/api';
import { peerName, type Conversation } from '@/lib/conversations';

interface Contact {
  peerId: string;
  name: string;
  username: string;
  avatarUrl?: string;
  isOnline: boolean;
}

interface ContactGroup {
  letter: string;
  items: Contact[];
}

// The alphabetical index bucket for a contact: the first letter of its display
// name, or "#" for names that don't start with a Latin letter (digits, symbols,
// non-Latin scripts) so they sort into a single trailing group.
function bucketFor(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

export function ContactsView({
  conversations,
  onlinePeers,
  onSelectContact,
  onNewChat,
}: {
  conversations: Conversation[];
  onlinePeers: ReadonlySet<string>;
  onSelectContact: (peerId: string) => void;
  onNewChat: () => void;
}) {
  const [query, setQuery] = useState('');

  const contacts = useMemo<Contact[]>(
    () =>
      conversations.map((c) => ({
        peerId: c.peerId,
        name: peerName(c),
        username: c.peerUsername,
        avatarUrl: c.peerAvatarUrl,
        isOnline: onlinePeers.has(c.peerId),
      })),
    [conversations, onlinePeers],
  );

  const onlineCount = useMemo(() => contacts.filter((c) => c.isOnline).length, [contacts]);

  // Filter by real name OR username, then bucket A–Z (with a trailing "#"),
  // sorting names case-insensitively within each group for a clean directory.
  const groups = useMemo<ContactGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? contacts.filter(
          (c) => c.name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q),
        )
      : contacts;

    const byLetter = new Map<string, Contact[]>();
    for (const c of filtered) {
      const letter = bucketFor(c.name);
      const list = byLetter.get(letter);
      if (list) list.push(c);
      else byLetter.set(letter, [c]);
    }

    return [...byLetter.keys()]
      .sort((a, b) => {
        if (a === '#') return 1;
        if (b === '#') return -1;
        return a.localeCompare(b);
      })
      .map((letter) => ({
        letter,
        items: byLetter
          .get(letter)!
          .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })),
      }));
  }, [contacts, query]);

  const hasContacts = contacts.length > 0;
  const hasResults = groups.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white/40 dark:bg-slate-900/30">
      {/* Fixed frosted header: title, live count, and the search field. Sits
          outside the scroll region so it stays put as the list scrolls. */}
      <header className="shrink-0 border-b border-black/5 bg-white/70 px-5 pb-4 pt-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 sm:px-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Contacts
          </h1>
          {hasContacts && (
            <div className="flex items-center gap-2 pb-0.5 text-sm text-gray-500 dark:text-gray-400">
              <span>
                {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}
              </span>
              {onlineCount > 0 && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.7)]" />
                    {onlineCount} online
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or username"
            aria-label="Search contacts"
            disabled={!hasContacts}
            className="w-full rounded-xl border border-black/5 bg-gray-100/80 py-2.5 pl-10 pr-9 text-sm text-gray-900 outline-none transition-all duration-200 placeholder:text-gray-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-400/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:bg-white/10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Scroll region */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {!hasContacts ? (
          <EmptyPanel
            icon={<Users className="h-7 w-7" aria-hidden />}
            title="No contacts yet"
            body="People you start encrypted conversations with will appear here.">
            <Button label="New chat" variant="primary" onClick={onNewChat} />
          </EmptyPanel>
        ) : !hasResults ? (
          <EmptyPanel
            icon={<SearchX className="h-7 w-7" aria-hidden />}
            title="No matches"
            body={`No contacts match “${query.trim()}”.`}
          />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-1">
            {groups.map((group) => (
              <section key={group.letter}>
                <div className="flex items-center gap-3 px-3 pb-1 pt-4">
                  <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    {group.letter}
                  </span>
                  <span className="h-px flex-1 bg-black/5 dark:bg-white/10" />
                </div>
                <div className="flex flex-col">
                  {group.items.map((contact) => (
                    <ContactRow
                      key={contact.peerId}
                      contact={contact}
                      onSelect={() => onSelectContact(contact.peerId)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// A single interactive contact row: the whole row opens the chat (click or
// keyboard), and a Message button on the right lights up on hover/focus.
function ContactRow({ contact, onSelect }: { contact: Contact; onSelect: () => void }) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-label={`Open chat with ${contact.name}`}
      className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl p-3 outline-none transition-colors duration-200 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-sky-400/50 dark:hover:bg-white/10">
      <div className="flex min-w-0 items-center gap-3">
        {/* Avatar + presence badge */}
        <div className="relative flex-shrink-0">
          <Avatar src={resolveAvatarUrl(contact.avatarUrl)} name={contact.name} size={40} />
          {contact.isOnline ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
              <span className="relative h-3.5 w-3.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] ring-2 ring-white dark:ring-slate-900" />
            </span>
          ) : (
            <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-gray-300 ring-2 ring-white dark:bg-gray-600 dark:ring-slate-900" />
          )}
        </div>

        {/* Name + handle */}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-gray-900 dark:text-white">
            {contact.name}
          </span>
          <span className="truncate text-sm text-gray-500 dark:text-gray-400">
            @{contact.username}
          </span>
        </div>
      </div>

      {/* Quick action — appears on row hover/focus, always shown on touch. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        aria-label={`Message ${contact.name}`}
        title="Message"
        className="flex-shrink-0 rounded-lg p-2 text-gray-400 dark:text-gray-500 opacity-0 transition-all duration-200 hover:bg-sky-500 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 [@media(hover:none)]:opacity-100">
        <MessageCircle className="h-5 w-5" />
      </button>
    </div>
  );
}

// Centered empty/zero-result panel shared by the "no contacts" and "no matches"
// states.
function EmptyPanel({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-dashed border-black/10 bg-white/50 px-6 py-12 text-center dark:border-white/10 dark:bg-white/5">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sky-600 dark:from-sky-500/20 dark:to-indigo-500/20 dark:text-sky-300">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">{body}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}
