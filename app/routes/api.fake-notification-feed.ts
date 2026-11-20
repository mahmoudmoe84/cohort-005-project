import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.fake-notification-feed";
import { getCurrentUserId } from "~/lib/session";
import { configuredFakeNotificationProvider } from "~/lib/notification-provider.server";
import { parseFormData } from "~/lib/validation";

// ─── The fake Notification Feed ───
// Dev only: the fake browser client polls this route to read the fake
// Notification Provider's store, so the bell works without a Knock account.
// It's a 404 whenever a real provider is configured, and it only ever serves
// the signed-in person's own Notification Feed.

const pageQuerySchema = z.object({
  userId: z.coerce.number().int(),
  cursor: z.string().min(1).optional(),
});

const feedActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("mark-read"),
    userId: z.coerce.number().int(),
    notificationId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("mark-all-read"),
    userId: z.coerce.number().int(),
  }),
]);

// The fake browser client asks for the person it was built for. After a DevUI
// user switch, a client left over from the last person gets a 403, never the
// new person's Notifications.
async function requireOwnFeed(request: Request, userId: number) {
  const fake = configuredFakeNotificationProvider();
  if (!fake) {
    throw data("Not found", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (currentUserId === null) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  if (currentUserId !== userId) {
    throw data("That isn't your Notification Feed.", { status: 403 });
  }

  return fake.feedOf(userId);
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const parsed = pageQuerySchema.safeParse(
    Object.fromEntries(url.searchParams)
  );
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const feed = await requireOwnFeed(request, parsed.data.userId);

  return Response.json({
    ...feed.page(parsed.data.cursor),
    unreadCount: feed.unreadCount(),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, feedActionSchema);
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const feed = await requireOwnFeed(request, parsed.data.userId);

  if (parsed.data.intent === "mark-read") {
    feed.markRead(parsed.data.notificationId);
  } else {
    feed.markAllRead();
  }

  return Response.json({ unreadCount: feed.unreadCount() });
}
