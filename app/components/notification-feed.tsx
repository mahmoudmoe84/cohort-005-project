import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useRevalidator } from "react-router";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import { Bell, Settings } from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  connectNotificationFeed,
  type NotificationFeedClient,
  type NotificationPage,
} from "~/lib/notification-feed-client";
import {
  emailAndPopUpsOn,
  NOTIFICATION_SETTINGS_URL,
  type FeedCredentials,
  type Notification,
  type NotificationActor,
  type SummaryPart,
} from "~/lib/notifications";
import { cn, formatRelativeTime } from "~/lib/utils";

// ─── Notification Feed ───
// The bell at the right of the sidebar's top row, the popover Notification
// Feed it opens, and the live pop-up when a Notification arrives. These are
// Cadence's own components over the NotificationFeedClient interface, so they
// stay put when the Notification Provider changes (ADR 0013).

/** How long a live pop-up stays on screen. */
const POP_UP_MS = 6000;

// ─── What the browser holds ───

type FeedState = {
  /** Every page loaded so far and everything that arrived since, newest first. */
  notifications: Notification[];
  status: "loading" | "ready" | "failed";
  /** Where the next, older page starts, or null when there are no more. */
  nextCursor: string | null;
  unreadCount: number;
};

type FeedEvent =
  | { type: "newest-page-loaded"; page: NotificationPage }
  | { type: "newest-page-refreshed"; page: NotificationPage }
  | { type: "newest-page-failed" }
  | { type: "older-page-loaded"; page: NotificationPage }
  | { type: "arrived"; notification: Notification }
  | { type: "counted"; unreadCount: number }
  | { type: "marked-read"; id: string; readAt: string }
  | { type: "marked-all-read"; readAt: string };

const initialFeedState: FeedState = {
  notifications: [],
  status: "loading",
  nextCursor: null,
  unreadCount: 0,
};

function withoutRepeats(notifications: Notification[]): Notification[] {
  const ids = new Set<string>();
  return notifications.filter((notification) => {
    if (ids.has(notification.id)) return false;
    ids.add(notification.id);
    return true;
  });
}

function feedReducer(state: FeedState, event: FeedEvent): FeedState {
  switch (event.type) {
    case "newest-page-loaded":
      return {
        ...state,
        status: "ready",
        // Anything that arrived before the page came back stays on top.
        notifications: withoutRepeats([
          ...state.notifications,
          ...event.page.notifications,
        ]),
        nextCursor: event.page.nextCursor,
      };

    case "newest-page-refreshed": {
      // Opening a page can mark Notifications read on the server, so the page
      // brings their read state. Read only goes one way: a page fetched before
      // a mark-read here landed doesn't undo it.
      const loaded = new Map(
        state.notifications.map((notification) => [
          notification.id,
          notification,
        ])
      );
      const newest = event.page.notifications.map((notification) => {
        const known = loaded.get(notification.id);
        return known?.readAt ? known : notification;
      });
      return {
        ...state,
        notifications: withoutRepeats([...newest, ...state.notifications]),
      };
    }

    case "newest-page-failed":
      return { ...state, status: "failed" };

    case "older-page-loaded":
      return {
        ...state,
        notifications: withoutRepeats([
          ...state.notifications,
          ...event.page.notifications,
        ]),
        nextCursor: event.page.nextCursor,
      };

    case "arrived": {
      const { notification } = event;
      if (state.notifications.some((known) => known.id === notification.id)) {
        return state;
      }
      return {
        ...state,
        notifications: [notification, ...state.notifications],
        unreadCount: state.unreadCount + (notification.readAt === null ? 1 : 0),
      };
    }

    case "counted":
      return { ...state, unreadCount: event.unreadCount };

    case "marked-read": {
      const target = state.notifications.find(
        (notification) => notification.id === event.id
      );
      if (!target || target.readAt !== null) return state;
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === event.id
            ? { ...notification, readAt: event.readAt }
            : notification
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }

    case "marked-all-read":
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.readAt === null
            ? { ...notification, readAt: event.readAt }
            : notification
        ),
        unreadCount: 0,
      };
  }
}

// ─── The provider ───

type NotificationFeed = {
  /** Newest first: what's loaded so far, plus anything that arrived since. */
  notifications: Notification[];
  status: FeedState["status"];
  /** Whether older Notifications are still to load. */
  hasOlder: boolean;
  unreadCount: number;
  /** The person's switch on Notification settings. */
  emailAndPopUps: boolean;
  /** Whether the Notification Feed is on screen. */
  open: boolean;
  setOpen(open: boolean): void;
  loadOlder(): void;
  markRead(id: string): void;
  markAllRead(): void;
  /** Marks it read, closes the feed and goes to what it's about. */
  view(notification: Notification): void;
};

/** What one connection to the Notification Provider can be asked to do. */
type FeedConnection = {
  loadOlder(cursor: string): void;
  markRead(id: string): void;
  markAllRead(): void;
  /** Looks again at the unread count and the newest page. */
  refresh(): void;
};

const NotificationFeedContext = createContext<NotificationFeed | null>(null);

function logFeedError(error: unknown) {
  console.error("The Notification Feed failed", error);
}

/**
 * Connects to one person's Notification Feed and pops up what arrives. Key it
 * on the person, so a DevUI user switch disconnects the old client, clears its
 * pop-ups and connects a new one.
 */
export function NotificationFeedProvider({
  credentials,
  emailAndPopUps,
  children,
}: {
  credentials: FeedCredentials;
  /** The person's switch on Notification settings. */
  emailAndPopUps: boolean;
  children: React.ReactNode;
}) {
  // Every loader run hands over fresh credentials for the same person. The
  // key, not the credentials, decides when to reconnect.
  const [initialCredentials] = useState(credentials);
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const [connection, setConnection] = useState<FeedConnection | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const location = useLocation();

  // A Notification about the page you're on links to it with only a new hash,
  // and React Router doesn't load a page's data again for a hash change, so
  // what just arrived wouldn't be there. Load it again, then bring the anchor
  // into view.
  const goTo = useCallback(
    async (url: string) => {
      const target = new URL(url, window.location.href);
      const hashOnly =
        target.pathname === window.location.pathname &&
        target.search === window.location.search &&
        target.hash !== "";
      await navigate(url);
      if (!hashOnly) return;
      await revalidate();
      scrollToAnchor(decodeURIComponent(target.hash.slice(1)));
    },
    [navigate, revalidate]
  );

  const view = useCallback(
    (notification: Notification) => {
      connection?.markRead(notification.id);
      setOpen(false);
      goTo(notification.url).catch(logFeedError);
    },
    [connection, goTo]
  );

  // Reads the switch and whether the Notification Feed is open as they are
  // when the Notification arrives. Returns the pop-up's id, if it popped up.
  const popUp = useEffectEvent((notification: Notification): string | null => {
    if (!popsUp(notification, emailAndPopUps, open)) return null;
    return showPopUp(notification, () => view(notification));
  });

  useEffect(() => {
    // The browser adapter turns down credentials it can't read. The bell then
    // says it couldn't load the Notifications, rather than the page breaking.
    let client: NotificationFeedClient;
    try {
      client = connectNotificationFeed(initialCredentials);
    } catch (error) {
      logFeedError(error);
      dispatch({ type: "newest-page-failed" });
      return;
    }
    let connected = true;
    let countsAsked = 0;
    let loadingOlder = false;
    const popUps = new Set<string>();

    function refreshUnreadCount() {
      const asked = ++countsAsked;
      client.unreadCount().then((unreadCount) => {
        // Only the latest answer counts: an earlier one may predate a change.
        if (connected && asked === countsAsked) {
          dispatch({ type: "counted", unreadCount });
        }
      }, logFeedError);
    }

    function markRead(id: string) {
      dispatch({ type: "marked-read", id, readAt: new Date().toISOString() });
      client.markRead(id).catch(logFeedError).then(refreshUnreadCount);
    }

    client.fetchPage().then(
      (page) => {
        if (connected) dispatch({ type: "newest-page-loaded", page });
      },
      (error) => {
        logFeedError(error);
        if (connected) dispatch({ type: "newest-page-failed" });
      }
    );
    refreshUnreadCount();

    const stopArrivals = client.onArrival((notification) => {
      dispatch({ type: "arrived", notification });
      refreshUnreadCount();
      const popUpId = popUp(notification);
      if (popUpId !== null) popUps.add(popUpId);
    });

    setConnection({
      markRead,

      markAllRead() {
        dispatch({ type: "marked-all-read", readAt: new Date().toISOString() });
        client.markAllRead().catch(logFeedError).then(refreshUnreadCount);
      },

      loadOlder(cursor) {
        if (loadingOlder) return;
        loadingOlder = true;
        client.fetchPage(cursor).then(
          (page) => {
            loadingOlder = false;
            if (connected) dispatch({ type: "older-page-loaded", page });
          },
          (error) => {
            loadingOlder = false;
            logFeedError(error);
          }
        );
      },

      // Counts once the page is back, because a provider's count can come
      // from its latest page.
      refresh() {
        client
          .fetchPage()
          .then((page) => {
            if (connected) dispatch({ type: "newest-page-refreshed", page });
          }, logFeedError)
          .then(refreshUnreadCount);
      },
    });

    return () => {
      connected = false;
      stopArrivals();
      client.disconnect();
      // A pop-up never outlives its person's connection.
      for (const id of popUps) toast.dismiss(id);
    };
  }, [initialCredentials]);

  // Opening a page can mark its Notifications read on the server, however
  // the person got there, so look again each time a navigation lands. On
  // connecting, the connection has just looked.
  const lookedAt = useRef(location.key);
  useEffect(() => {
    if (location.key === lookedAt.current) return;
    lookedAt.current = location.key;
    connection?.refresh();
  }, [connection, location.key]);

  const value = useMemo<NotificationFeed>(() => {
    const { nextCursor } = state;
    return {
      notifications: state.notifications,
      status: state.status,
      hasOlder: nextCursor !== null,
      unreadCount: state.unreadCount,
      emailAndPopUps,
      open,
      setOpen,
      loadOlder() {
        if (nextCursor !== null) connection?.loadOlder(nextCursor);
      },
      markRead(id) {
        connection?.markRead(id);
      },
      markAllRead() {
        connection?.markAllRead();
      },
      view,
    };
  }, [state, emailAndPopUps, open, connection, view]);

  return (
    <NotificationFeedContext.Provider value={value}>
      {children}
    </NotificationFeedContext.Provider>
  );
}

// The page renders its fresh data a moment after it loads, so look for the
// anchor on each frame, for about a second.
function scrollToAnchor(id: string, framesLeft = 60) {
  const anchor = document.getElementById(id);
  if (anchor) {
    anchor.scrollIntoView();
  } else if (framesLeft > 0) {
    requestAnimationFrame(() => scrollToAnchor(id, framesLeft - 1));
  }
}

function useNotificationFeed(): NotificationFeed {
  const feed = useContext(NotificationFeedContext);
  if (!feed) {
    throw new Error("useNotificationFeed needs a NotificationFeedProvider");
  }
  return feed;
}

// ─── Live pop-ups ───

// Nothing pops up over the open Notification Feed: the new Notification shows
// at the top of the list instead. With the switch off, only a kind that
// ignores it pops up. A Notification that's already read isn't news.
function popsUp(
  notification: Notification,
  emailAndPopUps: boolean,
  feedOpen: boolean
): boolean {
  if (feedOpen || notification.readAt !== null) return false;
  return emailAndPopUpsOn(notification.kind, emailAndPopUps);
}

/** Pops the Notification up through the layout's Toaster and returns its id. */
function showPopUp(notification: Notification, onView: () => void): string {
  const id = `notification-${notification.id}`;
  toast(<Summary parts={notification.summary} className="text-sm" />, {
    id,
    description: notification.context,
    icon: (
      <NotificationAvatar
        actor={notification.actor}
        className="size-6 text-[10px]"
      />
    ),
    // sonner's icon slot is 16px square, too small for the avatar.
    classNames: { icon: "size-6!" },
    action: { label: "View", onClick: onView },
    duration: POP_UP_MS,
  });
  return id;
}

// ─── The bell and the popover ───

const FILTERS = ["all", "unread", "read"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  unread: "Unread",
  read: "Read",
};

function isShown(notification: Notification, filter: Filter): boolean {
  if (filter === "unread") return notification.readAt === null;
  if (filter === "read") return notification.readAt !== null;
  return true;
}

export function NotificationBell() {
  const feed = useNotificationFeed();
  const [filter, setFilter] = useState<Filter>("all");
  const list = useRef<HTMLDivElement>(null);
  const { unreadCount } = feed;
  const close = () => feed.setOpen(false);
  const shown = feed.notifications.filter((notification) =>
    isShown(notification, filter)
  );

  return (
    <Popover.Root open={feed.open} onOpenChange={feed.setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 flex max-h-[min(560px,80vh)] w-[380px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <select
              aria-label="Show"
              value={filter}
              onChange={(event) => {
                const next = FILTERS.find(
                  (option) => option === event.target.value
                );
                if (next) setFilter(next);
              }}
              className="rounded border bg-background px-1.5 py-0.5 text-xs"
            >
              {FILTERS.map((option) => (
                <option key={option} value={option}>
                  {FILTER_LABELS[option]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={feed.markAllRead}
              disabled={unreadCount === 0}
              className="ml-auto text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>
          {!feed.emailAndPopUps && <EmailAndPopUpsOffLine onNavigate={close} />}
          <div ref={list} className="flex-1 overflow-y-auto">
            {feed.status === "loading" ? (
              <FeedMessage>Loading…</FeedMessage>
            ) : feed.status === "failed" ? (
              <FeedMessage>Couldn't load your Notifications.</FeedMessage>
            ) : shown.length === 0 && !feed.hasOlder ? (
              <FeedMessage>You're all caught up.</FeedMessage>
            ) : (
              <>
                {shown.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onClick={(event) => {
                      // A modifier key opens it in a new tab or window, which
                      // the browser does. Other clicks view it here.
                      if (opensElsewhere(event)) {
                        feed.markRead(notification.id);
                        return;
                      }
                      event.preventDefault();
                      feed.view(notification);
                    }}
                  />
                ))}
                {feed.hasOlder && (
                  // A new marker for every page, so it looks again in case
                  // the filter leaves it in view.
                  <LoadOlder
                    key={feed.notifications.length}
                    scrollArea={list}
                    onReach={feed.loadOlder}
                  />
                )}
              </>
            )}
          </div>
          <div className="flex items-center border-t px-4 py-2 text-xs text-muted-foreground">
            <Link
              to={NOTIFICATION_SETTINGS_URL}
              onClick={close}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Settings className="size-3" />
              Notification settings
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FeedMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

// Sits under the last Notification while older ones remain, and loads the
// next page as it scrolls into view.
function LoadOlder({
  scrollArea,
  onReach,
}: {
  scrollArea: React.RefObject<HTMLDivElement | null>;
  onReach: () => void;
}) {
  const marker = useRef<HTMLParagraphElement>(null);
  const reach = useEffectEvent(onReach);

  useEffect(() => {
    const element = marker.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reach();
      },
      // Start a little before the bottom, so scrolling rarely has to wait.
      { root: scrollArea.current, rootMargin: "0px 0px 160px 0px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollArea]);

  return (
    <p
      ref={marker}
      className="px-4 py-3 text-center text-xs text-muted-foreground"
    >
      Loading…
    </p>
  );
}

// With the switch off, Notifications still arrive here but aren't emailed or
// popped up, so the Notification Feed says why.
function EmailAndPopUpsOffLine({ onNavigate }: { onNavigate: () => void }) {
  return (
    <p className="m-3 mb-0 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      Email and pop-ups are off. Notifications still collect here.{" "}
      <Link
        to={NOTIFICATION_SETTINGS_URL}
        onClick={onNavigate}
        className="font-medium underline"
      >
        Change
      </Link>
    </p>
  );
}

function opensElsewhere(event: React.MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: Notification;
  onClick: (event: React.MouseEvent) => void;
}) {
  const unread = notification.readAt === null;

  return (
    <Link
      to={notification.url}
      onClick={onClick}
      className="flex w-full gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-accent"
    >
      <span
        aria-hidden
        className={cn(
          "mt-3 size-2 shrink-0 rounded-full",
          unread ? "bg-blue-600" : "bg-transparent"
        )}
      />
      <NotificationAvatar actor={notification.actor} />
      <span className="min-w-0 flex-1">
        {unread && <span className="sr-only">Unread: </span>}
        <Summary
          parts={notification.summary}
          className="block text-muted-foreground"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatRelativeTime(notification.insertedAt)}
        </span>
      </span>
    </Link>
  );
}

function NotificationAvatar({
  actor,
  className,
}: {
  actor: NotificationActor | null;
  className?: string;
}) {
  if (!actor) {
    // Cadence itself.
    return (
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground",
          className
        )}
      >
        C
      </span>
    );
  }
  return (
    <UserAvatar
      name={actor.name}
      avatarUrl={actor.avatarUrl}
      className={cn("shrink-0", className)}
    />
  );
}

function Summary({
  parts,
  className,
}: {
  parts: SummaryPart[];
  className?: string;
}) {
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.strong ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
