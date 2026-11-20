import Knock, {
  isRequestInFlight,
  type Feed,
  type FeedEventPayload,
  type FeedItem,
} from "@knocklabs/client";
import { z } from "zod";
import {
  arrivalCallbacks,
  NOTIFICATION_FEED_PAGE_SIZE,
  NOTIFICATION_KINDS,
  summarySchema,
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

/**
 * What Knock's server adapter gives the browser to connect with, inside
 * Cadence's opaque FeedCredentials. Only the two Knock adapters know what's
 * in it.
 */
const knockFeedCredentialsSchema = z.object({
  /** The person's id, as Knock knows them. */
  userId: z.string(),
  /** Knock's public API key, which is safe in the browser. */
  publicApiKey: z.string(),
  /** The id of Knock's in-app feed channel. */
  feedChannelId: z.string(),
  /** Proves to Knock who the browser is acting for. */
  userToken: z.string(),
});

export type KnockFeedCredentials = z.infer<typeof knockFeedCredentialsSchema>;

/**
 * The part of a workflow trigger's data that comes back on each feed item:
 * the Notification as Cadence wrote it. The server adapter sends it.
 */
const knockNotificationDataSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  actor_name: z.string().nullish(),
  actor_avatar_url: z.string().nullish(),
  summary: summarySchema,
  excerpt: z.string().nullish(),
  context: z.string(),
  url: z.string(),
});

export type KnockNotificationData = z.infer<typeof knockNotificationDataSchema>;

// Knock's feed client skips a fetch asked for while another is in flight, so
// fetchPage waits its turn, and tries again if another fetch got in first.
const FETCH_ATTEMPTS = 3;

/** Where the browser asks Cadence for fresh credentials. */
const FEED_CREDENTIALS_URL = "/api/notification-feed-credentials";

const freshCredentialsSchema = z.object({
  credentials: knockFeedCredentialsSchema,
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

/**
 * Builds the client from the credentials Knock's server adapter issued.
 * Throws when they aren't Knock's.
 */
export function connectKnockNotificationFeed(
  credentials: FeedCredentials
): NotificationFeedClient {
  const { userId, publicApiKey, feedChannelId, userToken } =
    knockFeedCredentialsSchema.parse(credentials);
  const knock = new Knock(publicApiKey);
  knock.authenticate({ id: userId }, userToken, {
    // Cadence's server registers people with Knock when it sends to them,
    // so the browser doesn't.
    identificationStrategy: "skip",
    onUserTokenExpiring: () => freshUserToken(userId),
  });
  // Rich mode keeps the summary's parts in each item's data. Knock's default,
  // compact, drops arrays and objects from it.
  const feed = knock.feeds.initialize(feedChannelId, {
    page_size: NOTIFICATION_FEED_PAGE_SIZE,
    mode: "rich",
  });

  // Every Notification this client has handed out, as Knock last gave it.
  const handedOut = new Map<string, FeedItem>();
  // Items that aren't Cadence's, so they're only warned about once.
  const skipped = new Set<string>();
  const arrivals = arrivalCallbacks();
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

  // Turns Knock's items into the Notifications this client hands out, and
  // remembers each item in handedOut. Leaves out any item that isn't a
  // Cadence Notification, such as a test sent from Knock's dashboard.
  function handOut(items: FeedItem[]): Notification[] {
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
    const arrived = handOut(items.filter((item) => !handedOut.has(item.id)));
    arrivals.arrived(arrived.reverse());
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
      const notifications = handOut(items);
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

    onArrival: arrivals.onArrival,

    disconnect() {
      arrivals.clear();
      feed.dispose();
      // Closes the socket and stops the user token's refresh timer.
      knock.logout();
    },
  };
}
