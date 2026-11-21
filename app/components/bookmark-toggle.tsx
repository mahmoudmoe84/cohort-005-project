import { useFetcher } from "react-router";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "~/components/ui/button";

/**
 * The one control that adds or removes the Student's Bookmark on a Lesson.
 * Posts `intent=toggle-bookmark` to the Lesson page's action.
 */
export function BookmarkToggle({ bookmarked }: { bookmarked: boolean }) {
  const fetcher = useFetcher<{ ok: boolean }>();
  const isSaving = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="toggle-bookmark" />
      <Button type="submit" variant="outline" size="sm" disabled={isSaving}>
        {bookmarked ? (
          <BookmarkCheck className="mr-1.5 size-4" />
        ) : (
          <Bookmark className="mr-1.5 size-4" />
        )}
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </Button>
    </fetcher.Form>
  );
}
