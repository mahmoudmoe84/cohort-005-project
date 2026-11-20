// PROTOTYPE, throwaway: variant C's full Notifications page (issue #17).
// The data comes from the in-memory prototype feed in layout.app.tsx.
import { VariantCPage } from "~/components/notifications-prototype";

export function meta() {
  return [{ title: "Notifications (prototype) — Cadence" }];
}

export default function PrototypeNotifications() {
  return <VariantCPage />;
}
