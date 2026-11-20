// PROTOTYPE, throwaway: answers "What do Notifications look like in Cadence?"
// (https://github.com/mahmoudmoe84/cohort-005-project/issues/17).
//
// Plan: three variants of the bell, the Notification Feed and the live pop-up,
// mounted in the real app shell (layout.app.tsx) on every page, switched with
// ?variant=A|B|C (remembered in a cookie so it survives navigation):
//   A  Knock's popover        bell in the sidebar's top row, Knock's prebuilt
//                             popover look, badge counts unseen, sonner toast
//   B  Top bar + side panel   a new header with the bell, full-height panel,
//                             badge counts unread, pop-up drops from the bell
//   C  Sidebar item + page    no bell: a "Notifications" sidebar item with a
//                             count, a full page, a callout pop-up
//
// Notifications are fake, built from real seed rows (fake-feed.server.ts) and
// kept in memory (state.tsx). "Send a Notification" on the prototype bar fakes
// a live arrival; the switch fakes the person's Notification setting.
import { Send } from "lucide-react";
import { Switch } from "radix-ui";
import { useNotificationsPrototype } from "./state";
import {
  PROTOTYPE_VARIANT_COOKIE,
  PROTOTYPE_VARIANTS,
  type PrototypeVariantKey,
} from "./types";

export { NotificationsPrototypeProvider } from "./state";
export { VariantABell } from "./variant-a";
export { VariantBTopBar } from "./variant-b";
export { VariantCNavItem, VariantCPage } from "./variant-c";
export { NotificationSettingsCard } from "./settings-card";
export { PROTOTYPE_VARIANTS, PROTOTYPE_VARIANT_COOKIE };

export function readPrototypeVariant(request: Request): PrototypeVariantKey {
  const fromUrl = new URL(request.url).searchParams.get("variant");
  const fromCookie = new RegExp(`(?:^|;\\s*)${PROTOTYPE_VARIANT_COOKIE}=([^;]+)`).exec(
    request.headers.get("Cookie") ?? ""
  )?.[1];
  const wanted = (fromUrl ?? fromCookie ?? "A").toUpperCase();
  return PROTOTYPE_VARIANTS.some((variant) => variant.key === wanted)
    ? (wanted as PrototypeVariantKey)
    : "A";
}

// Extra controls on the floating prototype bar, plus the state readout.
export function NotificationsPrototypeControls() {
  const prototype = useNotificationsPrototype();
  return (
    <>
      <button
        type="button"
        onClick={prototype.sendNext}
        disabled={!prototype.canSend}
        title={
          prototype.canSend
            ? "Fake a Notification arriving now"
            : "Nothing to send for this person. Switch user in DevUI."
        }
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-white/90 disabled:opacity-40"
      >
        <Send className="size-3" />
        Send a Notification
      </button>
      <label className="flex items-center gap-1.5 text-xs text-white/80">
        <Switch.Root
          checked={prototype.popUpsOn}
          onCheckedChange={prototype.setPopUpsOn}
          className="relative h-4 w-7 rounded-full bg-white/25 transition-colors data-[state=checked]:bg-emerald-500"
        >
          <Switch.Thumb className="block size-3 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[14px]" />
        </Switch.Root>
        Email &amp; pop-ups
      </label>
      <span className="font-mono text-[11px] text-white/60">
        unread {prototype.unreadCount} · unseen {prototype.unseenCount}
      </span>
    </>
  );
}
