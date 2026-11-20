import Knock, {
  isRequestInFlight,
  type Feed,
  type FeedEventPayload,
  type FeedItem,
} from "@knocklabs/client";
import { z } from "zod";
import {
  NOTIFICATION_KINDS,
  type FeedCredentials,
  type Notification,
} from "~/lib/notifications";
import type {
  NotificationFeedClient,
  NotificationPage,
} from "~/lib/notification-feed-client";

// ─── Knock ───
// The NotificationFeedClient adapter for Knock (ADR 0013). It and the Knock
// adapter in knock-notification-provider.server.ts are the only Cadence code
// that imports Knock. It wraps Knock's headless JS client, which talks to
// Knock directly and hears about arrivals over Knock's socket, and it hands
// Cadence its own Notification type, never Knock's feed items.

type KnockFeedCredentials = Extract<FeedCredentials, { provider: "knock" }>;

/**
 * The part of a workflow trigger's data that comes back on each feed item:
 * the Notification as Cadence wrote it. The server adapter sends it.
 */
const knockNotificationDataSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  actor_name: z.string().nullish(),
  actor_avatar_url: z.string().nullish(),
  summary: z.array(
    z.object({ text: z.string(), strong: z.boolean().optional() })
  ),
  excerpt: z.string().nullish(),
  context: z.string(),
  url: z.string(),
});

export type KnockNotificationData = z.infer<typeof knockNotificationDataSchema>;

// The same page size as the fake.
const PAGE_SIZE = 20;

// Knock's feed client skips a fetch asked for while another is in flight, so
// fetchPage waits its turn, and tries again if another fetch got in first.
const FETCH_ATTEMPTS = 3;

/** Where the browser asks Cadence for fresh credentials. */
const FEED_CREDENTIALS_URL = "/api/notification-feed-credentials";

const freshCredentialsSchema = z.object({
  credentials: z.object({
    provider: z.literal("knock"),
    userId: z.string(),
    userToken: z.string(),
  }),
});

// Knock asks for this shortly before the user token runs out. Cadence signs a
// new one for whoever is signed in, which has to be the same person. It never
// throws. When Cadence can't give a token, as with the 503 it answers while
// the Notification Provider fails, it logs why and gives none, and Knock
// keeps the old token until it runs out.
async function freshUserToken(userId: string): Promise<string | undefined> {
  try {
    const response = await fetch(FEED_CREDENTIALS_URL);
    if (!response.ok) {
      console.error(
        `Couldn't get a fresh Knock user token: Cadence answered ${response.status}`
      );
      return undefined;
    }
    const { credentials } = freshCredentialsSchema.parse(await response.json());
    // A different person is signed in now, as after a DevUI user switch in
    // another tab, and their token mustn't reach this person's client.
    if (credentials.userId !== userId) return undefined;
    return credentials.userToken;
  } catch (error) {
    console.error("Couldn't get a fresh Knock user token", error);
    return undefined;
  }
}

// Resolves once Knock's feed client has no fetch in flight.
function settled(feed: Feed): Promise<void> {
  return new Promise((resolve) => {
    if (!isRequestInFlight(feed.getState().networkStatus)) {
      resolve();
      return;
    }
    const stop = feed.store.subscribe((state) => {
      if (isRequestInFlight(state.networkStatus)) return;
      stop();
      resolve();
    });
  });
}

/** Builds the client from the credentials Knock's server adapter issued. */
export function connectKnockNotificationFeed(
  credentials: KnockFeedCredentials
): NotificationFeedClient {
  const knock = new Knock(credentials.publicApiKey);
  knock.authenticate({ id: credentials.userId }, credentials.userToken, {
    // Cadence's server registers people with Knock when it sends to them,
    // so the browser doesn't.
    identificationStrategy: "skip",
    onUserTokenExpiring: () => freshUserToken(credentials.userId),
  });
  // Rich mode keeps the summary's parts in each item's data. Knock's default,
  // compact, drops arrays and objects from it.
  const feed = knock.feeds.initialize(credentials.feedChannelId, {
    page_size: PAGE_SIZE,
    mode: "rich",
  });

  // Every Notification this client has handed out, as Knock last gave it.
  const handedOut = new Map<string, FeedItem>();
  // Items that aren't Cadence's, so they're only warned about once.
  const skipped = new Set<string>();
  const listeners = new Set<(notification: Notification) => void>();
  let listening = false;
  // The pages being fetched, which unreadCount waits for.
  const fetching = new Set<Promise<unknown>>();

  function toNotification(item: FeedItem): Notification | null {
    const parsed = knockNotificationDataSchema.safeParse(item.data);
    if (!parsed.success) return null;
    const {
      kind,
      actor_name: actorName,
      actor_avatar_url: actorAvatarUrl,
      summary,
      excerpt,
      context,
      url,
    } = parsed.data;
    return {
      id: item.id,
      kind,
      // No name means Cadence itself.
      actor: actorName
        ? { name: actorName, avatarUrl: actorAvatarUrl ?? null }
        : null,
      summary,
      excerpt: excerpt ?? null,
      context,
      url,
      insertedAt: item.inserted_at,
      readAt: item.read_at,
    };
  }

  // Remembers each item, and leaves out any that isn't a Cadence
  // Notification, such as a test sent from Knock's dashboard.
  function takeIn(items: FeedItem[]): Notification[] {
    const notifications: Notification[] = [];
    for (const item of items) {
      const notification = toNotification(item);
      if (notification) {
        handedOut.set(item.id, item);
        notifications.push(notification);
      } else if (!skipped.has(item.id)) {
        skipped.add(item.id);
        console.warn(
          `Left out Knock feed item ${item.id} from workflow ${item.source.key}: its data isn't a Cadence Notification`
        );
      }
    }
    return notifications;
  }

  // Knock fetches what arrived after the newest item it holds and lists it
  // newest first. Call back oldest first, as they arrived.
  function onRealtime({ items }: FeedEventPayload) {
    const arrivals = takeIn(items.filter((item) => !handedOut.has(item.id)));
    for (const notification of arrivals.reverse()) {
      for (const listener of listeners) listener(notification);
    }
  }
  feed.on("items.received.realtime", onRealtime);

  async function fetchFeed(cursor: string | undefined) {
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      await settled(feed);
      // Nothing else fetches while this does, so the page received is this
      // fetch's.
      const page: { items: FeedItem[] | null } = { items: null };
      const receive = (payload: FeedEventPayload) => {
        page.items = payload.items;
      };
      feed.on("items.received.page", receive);
      try {
        const result = await feed.fetch(
          cursor === undefined ? {} : { after: cursor }
        );
        // Another fetch got in first.
        if (result === undefined) continue;
        if (result.status !== "ok" || page.items === null) {
          throw new Error("Knock's feed didn't answer", {
            cause: result.data,
          });
        }
        return {
          items: page.items,
          nextCursor: feed.getState().pageInfo.after,
        };
      } finally {
        feed.off("items.received.page", receive);
      }
    }
    throw new Error(`Knock's feed stayed busy for ${FETCH_ATTEMPTS} tries`);
  }

  return {
    async fetchPage(cursor): Promise<NotificationPage> {
      const page = fetchFeed(cursor);
      fetching.add(page);
      const { items, nextCursor } = await page.finally(() => {
        fetching.delete(page);
      });
      const notifications = takeIn(items);
      // Listen only once the newest page is in. Before that Knock holds no
      // items, so its first live fetch would bring the whole newest page as
      // if it had just arrived.
      if (cursor === undefined && !listening) {
        listening = true;
        feed.listenForUpdates();
      }
      return { notifications, nextCursor };
    },

    // Knock's count from its last fetch or live arrival, less what this
    // client has marked read since.
    async unreadCount() {
      await Promise.allSettled(fetching);
      await settled(feed);
      return feed.getState().metadata.unread_count;
    },

    async markRead(id) {
      const item = handedOut.get(id);
      if (!item) {
        throw new Error(`Notification ${id} didn't come from this Knock feed`);
      }
      // On a client error Knock's client returns the error, not the messages.
      const marked = await feed.markAsRead(item);
      if (!Array.isArray(marked)) {
        throw new Error(`Knock didn't mark Notification ${id} read`, {
          cause: marked,
        });
      }
      handedOut.set(id, {
        ...item,
        read_at: item.read_at ?? new Date().toISOString(),
      });
    },

    // Knock finishes marking them on its side a little later.
    async markAllRead() {
      const operation = await feed.markAllAsRead();
      if (operation === undefined || operation instanceof Error) {
        throw new Error("Knock didn't mark the Notifications read", {
          cause: operation,
        });
      }
      const readAt = new Date().toISOString();
      for (const [id, item] of handedOut) {
        if (item.read_at === null) {
          handedOut.set(id, { ...item, read_at: readAt });
        }
      }
    },

    onArrival(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    disconnect() {
      listeners.clear();
      feed.dispose();
      // Closes the socket and stops the user token's refresh timer.
      knock.logout();
    },
  };
}
