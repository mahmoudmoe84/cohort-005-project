// PROTOTYPE, throwaway. Floating bar for flipping between UI prototype
// variants: ← / → buttons (and arrow keys) rewrite ?variant= in the URL.
// When `cookieName` is set the choice also survives navigation, for
// prototypes that live in the app shell rather than on one page.
// Never rendered in production builds.
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Variant = { key: string; name?: string };

export function PrototypeSwitcher({
  variants,
  current,
  cookieName,
  children,
}: {
  variants: readonly Variant[];
  current: string;
  cookieName?: string;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current)
  );

  const go = useCallback(
    (step: number) => {
      const next = variants[(index + step + variants.length) % variants.length];
      if (cookieName) {
        document.cookie = `${cookieName}=${next.key}; path=/; SameSite=Lax`;
      }
      const params = new URLSearchParams(location.search);
      params.set("variant", next.key);
      navigate(
        { pathname: location.pathname, search: `?${params}`, hash: location.hash },
        { replace: true, preventScrollReset: true }
      );
    },
    [variants, index, cookieName, location, navigate]
  );

  // Remember whichever variant is showing, including one opened straight from
  // a ?variant= link, so links without the param keep it.
  useEffect(() => {
    if (cookieName) {
      document.cookie = `${cookieName}=${current}; path=/; SameSite=Lax`;
    }
  }, [cookieName, current]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")
      ) {
        return;
      }
      go(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  if (!import.meta.env.DEV) return null;

  const variant = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-2xl ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous variant"
        className="rounded-full p-1 hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-44 px-1 text-center font-medium">
        {variant.key}
        {variant.name && <span className="text-white/60"> ({variant.name})</span>}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next variant"
        className="rounded-full p-1 hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
      {children && (
        <div className="ml-1 flex items-center gap-2 border-l border-white/20 pl-3 pr-1">
          {children}
        </div>
      )}
    </div>
  );
}
