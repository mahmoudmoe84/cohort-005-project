import { z } from "zod";
import { connectKnockNotificationFeed } from "~/lib/knock-notification-feed-client";
import {
  NOTIFICATION_KINDS,
  type FeedCredentials,
  type Notification,
} from "~/lib/notifications";

// ─── Notification Feed client ───
// How the browser reads one person's Notification Feed (ADR 0013). Cadence's
// components only talk to this interface. Each Notification Provider has an
// adapter behind it that returns Cadence's own Notification type: Knock's is
// in knock-notification-feed-client.ts, and the fake is below.

export type NotificationPage = {
  notifications: Notification[];
  nextCursor: string | null;
};

export interface NotificationFeedClient {
  /** Newest first. Pass the last page's nextCursor for older Notifications. */
  fetchPage(cursor?: string): Promise<NotificationPage>;
  /**
   * How many of the person's Notifications are unread, as of the latest page,
   * arrival or mark this client knows of. Fetch the newest page first to
   * catch up with changes made elsewhere, such as opening a page.
   */
  unreadCount(): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  /**
   * Calls back once for each Notification that arrives after connecting.
   * Returns a function that stops the callbacks.
   */
  onArrival(callback: (notification: Notification) => void): () => void;
  /** Stops listening for arrivals. */
  disconnect(): void;
}

/** Builds the client for whichever provider issued the credentials. */
export function connectNotificationFeed(
  credentials: FeedCredentials
): NotificationFeedClient {
  switch (credentials.provider) {
    case "knock":
      return connectKnockNotificationFeed(credentials);
    case "fake":
      return fakeNotificationFeedClient(credentials.userId);
  }
}

// ─── The fake ───
// Polls the dev-only route api/fake-notification-feed, which reads the fake
// Notification Provider's store on the server.

const FAKE_FEED_URL = "/api/fake-notification-feed";
const POLL_EVERY_MS = 3000;

const notificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  actor: z
    .object({ name: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  summary: z.array(
    z.object({ text: z.string(), strong: z.boolean().optional() })
  ),
  excerpt: z.string().nullable(),
  context: z.string(),
  url: z.string(),
  insertedAt: z.string(),
  readAt: z.string().nullable(),
}) satisfies z.ZodType<Notification>;

const fakeFeedPageSchema = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int(),
});

function fakeNotificationFeedClient(userId: number): NotificationFeedClient {
  const listeners = new Set<(notification: Notification) => void>();
  const known = new Set<string>();
  let hasLooked = false;
  let connected = true;

  async function readPage(cursor?: string) {
    const query = new URLSearchParams({ userId: String(userId) });
    if (cursor !== undefined) query.set("cursor", cursor);
    const response = await fetch(`${FAKE_FEED_URL}?${query}`);
    if (!response.ok) {
      throw new Error(`The fake Notification Feed answered ${response.status}`);
    }
    return fakeFeedPageSchema.parse(await response.json());
  }

  async function post(fields: Record<string, string>) {
    const response = await fetch(FAKE_FEED_URL, {
      method: "POST",
      body: new URLSearchParams({ userId: String(userId), ...fields }),
    });
    if (!response.ok) {
      throw new Error(`The fake Notification Feed answered ${response.status}`);
    }
  }

  // The first look only learns what's already there. After that, anything
  // not seen before has just arrived.
  function takeIn(notifications: Notification[]): Notification[] {
    const arrivals = hasLooked
      ? notifications.filter((notification) => !known.has(notification.id))
      : [];
    for (const notification of notifications) known.add(notification.id);
    hasLooked = true;
    return arrivals;
  }

  async function lookForArrivals() {
    try {
      const page = await readPage();
      const arrivals = takeIn(page.notifications).reverse();
      if (!connected) return;
      for (const notification of arrivals) {
        for (const listener of listeners) listener(notification);
      }
    } catch (error) {
      console.error("Couldn't poll the fake Notification Feed", error);
    }
  }

  const timer = setInterval(lookForArrivals, POLL_EVERY_MS);

  return {
    async fetchPage(cursor) {
      const { notifications, nextCursor } = await readPage(cursor);
      // The first page is what's already there, so none of it counts as
      // arriving. A page fetched later, after a navigation, leaves arrivals to
      // the poll, so they still pop up.
      if (!hasLooked) takeIn(notifications);
      return { notifications, nextCursor };
    },

    async unreadCount() {
      return (await readPage()).unreadCount;
    },

    markRead(id) {
      return post({ intent: "mark-read", notificationId: id });
    },

    markAllRead() {
      return post({ intent: "mark-all-read" });
    },

    onArrival(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    disconnect() {
      connected = false;
      clearInterval(timer);
      listeners.clear();
    },
  };
}
