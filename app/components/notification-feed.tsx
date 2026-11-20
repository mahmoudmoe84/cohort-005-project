import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router";
import { Popover } from "radix-ui";
import { Bell } from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  connectNotificationFeed,
  type NotificationFeedClient,
} from "~/lib/notification-feed-client";
import type {
  FeedCredentials,
  Notification,
  NotificationActor,
  SummaryPart,
} from "~/lib/notifications";
import { cn, formatRelativeTime } from "~/lib/utils";

// ─── Notification Feed ───
// The bell at the right of the sidebar's top row, and the popover Notification
// Feed it opens. These are Cadence's own components over the
// NotificationFeedClient interface, so they stay put when the Notification
// Provider changes (ADR 0013).

type NotificationFeed = {
  /** The newest page, plus anything that arrived since. */
  notifications: Notification[];
  unreadCount: number;
  markRead(notification: Notification): void;
};

const NotificationFeedContext = createContext<NotificationFeed | null>(null);

function logFeedError(error: unknown) {
  console.error("The Notification Feed failed", error);
}

/**
 * Connects to one person's Notification Feed. Key it on the person, so a
 * DevUI user switch disconnects the old client and connects a new one.
 */
export function NotificationFeedProvider({
  credentials,
  children,
}: {
  credentials: FeedCredentials;
  children: React.ReactNode;
}) {
  // Every loader run hands over fresh credentials for the same person. The
  // key, not the credentials, decides when to reconnect.
  const [initialCredentials] = useState(credentials);
  const [client, setClient] = useState<NotificationFeedClient | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const feed = connectNotificationFeed(initialCredentials);
    let connected = true;

    function refreshUnreadCount() {
      feed.unreadCount().then((count) => {
        if (connected) setUnreadCount(count);
      }, logFeedError);
    }

    feed.fetchPage().then((page) => {
      if (connected) setNotifications(page.notifications);
    }, logFeedError);
    refreshUnreadCount();

    const stopArrivals = feed.onArrival((notification) => {
      setNotifications((current) =>
        current.some((existing) => existing.id === notification.id)
          ? current
          : [notification, ...current]
      );
      refreshUnreadCount();
    });

    setClient(feed);

    return () => {
      connected = false;
      stopArrivals();
      feed.disconnect();
    };
  }, [initialCredentials]);

  const markRead = useCallback(
    (notification: Notification) => {
      if (!client || notification.readAt !== null) return;

      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((existing) =>
          existing.id === notification.id ? { ...existing, readAt } : existing
        )
      );
      setUnreadCount((count) => Math.max(0, count - 1));

      client
        .markRead(notification.id)
        .then(() => client.unreadCount())
        .then(setUnreadCount, logFeedError);
    },
    [client]
  );

  const value = useMemo(
    () => ({ notifications, unreadCount, markRead }),
    [notifications, unreadCount, markRead]
  );

  return (
    <NotificationFeedContext.Provider value={value}>
      {children}
    </NotificationFeedContext.Provider>
  );
}

function useNotificationFeed(): NotificationFeed {
  const feed = useContext(NotificationFeedContext);
  if (!feed) {
    throw new Error("useNotificationFeed needs a NotificationFeedProvider");
  }
  return feed;
}

export function NotificationBell() {
  const feed = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const { unreadCount } = feed;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
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
          <h2 className="border-b px-4 py-3 text-sm font-semibold">
            Notifications
          </h2>
          <div className="flex-1 overflow-y-auto">
            {feed.notifications.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            ) : (
              feed.notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={() => {
                    feed.markRead(notification);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationItem({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: () => void;
}) {
  const unread = notification.readAt === null;

  return (
    <Link
      to={notification.url}
      onClick={onOpen}
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
        <Summary parts={notification.summary} />
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatRelativeTime(notification.insertedAt)}
        </span>
      </span>
    </Link>
  );
}

function NotificationAvatar({ actor }: { actor: NotificationActor | null }) {
  if (!actor) {
    // Cadence itself.
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        C
      </span>
    );
  }
  return (
    <UserAvatar
      name={actor.name}
      avatarUrl={actor.avatarUrl}
      className="shrink-0"
    />
  );
}

function Summary({ parts }: { parts: SummaryPart[] }) {
  return (
    <span className="block text-muted-foreground">
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
