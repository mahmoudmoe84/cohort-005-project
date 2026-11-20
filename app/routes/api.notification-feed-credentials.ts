import { data } from "react-router";
import type { Route } from "./+types/api.notification-feed-credentials";
import { getCurrentUserId } from "~/lib/session";
import { notificationFeedCredentials } from "~/lib/notifications.server";

// ─── Fresh Notification Feed credentials ───
// The browser adapter connects with the credentials the layout hands it, and
// asks here when they're about to run out, as Knock's user token does after an
// hour. It only ever gives the signed-in person's own.

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  return Response.json(
    { credentials: await notificationFeedCredentials(userId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
