import { data } from "react-router";
import type { Route } from "./+types/api.notification-feed-token";
import { requireSignedIn } from "~/modules/course-access/index.server";
import { defaultNotifications } from "~/lib/notifications.server";

/**
 * A fresh signed user token for the signed-in person's Notification Feed. The
 * browser asks for one shortly before its current token expires, so a tab
 * left open past the token's lifetime keeps its live feed.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await requireSignedIn(request);

  const credentials = await (
    await defaultNotifications()
  ).feedCredentials(currentUserId);
  if (!credentials) {
    throw data("No Notification Feed", { status: 404 });
  }

  return { userId: credentials.userId, userToken: credentials.userToken };
}
