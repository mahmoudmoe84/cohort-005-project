import { useId } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { Switch } from "radix-ui";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/settings.notifications";
import { db } from "~/db";
import { users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";

// ─── Notification settings ───
// One switch per person for email and live pop-ups. Off, Notifications still
// collect in the Notification Feed and count on the bell. Refund Request
// decided ignores the switch (ADR 0013).

const switchSchema = z.object({
  emailAndPopUps: z.enum(["on", "off"]),
});

export function meta() {
  return [
    { title: "Notification settings — Cadence" },
    { name: "description", content: "Choose how Notifications reach you" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data(
      "Select a user from the DevUI panel to change your Notification settings.",
      { status: 401 }
    );
  }

  const currentUser = db
    .select({ emailAndPopUps: users.emailAndPopUps })
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  return { emailAndPopUps: currentUser.emailAndPopUps };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const parsed = parseFormData(await request.formData(), switchSchema);
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  // Only the switch changes. Turning it back on sends nothing for what
  // happened while it was off.
  const updated = db
    .update(users)
    .set({ emailAndPopUps: parsed.data.emailAndPopUps === "on" })
    .where(eq(users.id, currentUserId))
    .returning({ id: users.id })
    .get();

  if (!updated) {
    throw data("User not found.", { status: 404 });
  }

  return { ok: true };
}

export default function NotificationSettings({
  loaderData,
}: Route.ComponentProps) {
  const fetcher = useFetcher<typeof action>();
  const labelId = useId();
  const descriptionId = useId();

  // While a change saves, show the switch where it's going.
  const saving = fetcher.formData?.get("emailAndPopUps");
  const on =
    typeof saving === "string" ? saving === "on" : loaderData.emailAndPopUps;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/settings" className="hover:text-foreground">
          Settings
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Notifications</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Notification settings</h1>
        <p className="mt-1 text-muted-foreground">
          Choose how Notifications reach you
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Notifications</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span id={labelId} className="block text-sm font-medium">
                Email and pop-ups for Notifications
              </span>
              <span
                id={descriptionId}
                className="mt-1 block text-sm text-muted-foreground"
              >
                {on
                  ? "We email you about some Notifications and pop new ones up while you're on Cadence."
                  : "Off. Notifications still collect behind the bell, but we won't email you or pop them up."}
              </span>
            </span>
            <Switch.Root
              checked={on}
              onCheckedChange={(checked) =>
                fetcher.submit(
                  { emailAndPopUps: checked ? "on" : "off" },
                  { method: "post" }
                )
              }
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-input transition-colors data-[state=checked]:bg-primary"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
          </label>
          <p className="text-xs text-muted-foreground">
            Refund Request decisions always reach you by email and pop-up,
            because they carry the money details.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 404) {
      title = "User not found";
      message =
        typeof error.data === "string" ? error.data : "User not found.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
