import { useSyncExternalStore, type CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Cadence's Toaster: sonner in Cadence's colours, following Cadence's dark
// mode. Dark mode is the "dark" class on <html> (root.tsx sets it, the sidebar
// toggles it), not the system setting, so the Toaster watches that class.

function subscribeToDarkMode(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

// A plain toast takes the popover's colours. Success, error and the other rich
// colours keep sonner's own, which follow the theme.
const popoverColors: CSSProperties & Record<`--${string}`, string> = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
};

export function Toaster(props: ToasterProps) {
  const dark = useSyncExternalStore(
    subscribeToDarkMode,
    isDarkMode,
    () => false
  );

  return (
    <Sonner theme={dark ? "dark" : "light"} style={popoverColors} {...props} />
  );
}
