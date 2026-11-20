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

  // The layout opens the page without the bell when this fails, but here
  // there's nothing else to give. The failure is already logged.
  const credentials = await notificationFeedCredentials(userId);
  if (credentials === null) {
    throw data("The Notification Provider can't give credentials right now.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json(
    { credentials },
    { headers: { "Cache-Control": "no-store" } }
  );
}
