// PROTOTYPE, throwaway. The one Notification switch decided in "Can people turn
// Notifications off, and how finely?", shown as a card on /settings. The real
// build moves it to its own Notification settings page in a settings area.
// It drives the same in-memory switch as the prototype bar.
import { Switch } from "radix-ui";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { useOptionalNotificationsPrototype } from "./state";

export function NotificationSettingsCard() {
  const prototype = useOptionalNotificationsPrototype();
  if (!prototype) return null;

  return (
    <Card id="notifications" className="mt-8 max-w-md scroll-mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">
              Email and pop-ups for Notifications
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {prototype.popUpsOn
                ? "We email you about some Notifications and pop new ones up while you're on Cadence."
                : "Off. Notifications still collect behind the bell, but we won't email you or pop them up."}
            </span>
          </span>
          <Switch.Root
            checked={prototype.popUpsOn}
            onCheckedChange={prototype.setPopUpsOn}
            className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-input transition-colors data-[state=checked]:bg-primary"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]" />
          </Switch.Root>
        </label>
        <p className="text-xs text-muted-foreground">
          Refund decisions always reach you by email and pop-up, because they
          carry the money details.
        </p>
      </CardContent>
    </Card>
  );
}
