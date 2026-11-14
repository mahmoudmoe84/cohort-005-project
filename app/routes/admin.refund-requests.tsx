import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/admin.refund-requests";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { formatDuration, formatPrice } from "~/lib/utils";
import { db } from "~/db";
import { RefundRequestStatus, UserRole, users } from "~/db/schema";
import {
  decideRefundRequest,
  getDecidedRefundRequests,
  getRequestedRefundRequests,
} from "~/lib/refund-requests.server";
import {
  REFUND_COMPLETION_LIMIT,
  REFUND_WATCH_LIMIT_SECONDS,
  REFUND_WINDOW_DAYS,
  toCalendarDay,
} from "~/lib/refund-requests";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

const decisionSchema = z.object({
  refundRequestId: z.coerce.number().int(),
  decision: z.enum([
    RefundRequestStatus.Approved,
    RefundRequestStatus.Declined,
  ]),
});

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can review refund requests.", { status: 403 });
  }

  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Review refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return {
    refundRequests: getRequestedRefundRequests(),
    decidedRefundRequests: getDecidedRefundRequests(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    throw data("Invalid decision.", { status: 400 });
  }

  const { refundRequestId, decision } = parsed.data;
  const decided = decideRefundRequest(refundRequestId, decision, admin.id);

  if (!decided) {
    throw data("This refund request has already been approved or declined.", {
      status: 409,
    });
  }

  return { decision };
}

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { refundRequests, decidedRefundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve a refund request when the purchase is still eligible, whatever
          reason the student gave. Approving ends their access to the course and
          cannot be undone.
        </p>
      </div>

      <Tabs defaultValue="requested">
        <TabsList className="mb-6">
          <TabsTrigger value="requested">
            Requested ({refundRequests.length})
          </TabsTrigger>
          <TabsTrigger value="decided">Decided</TabsTrigger>
        </TabsList>

        <TabsContent value="requested">
          {refundRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No refund requests are waiting for review.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {refundRequests.map((refundRequest) => (
                <RefundRequestCard
                  key={refundRequest.id}
                  refundRequest={refundRequest}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="decided">
          <DecidedLog refundRequests={decidedRefundRequests} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type RequestedRefundRequest =
  Route.ComponentProps["loaderData"]["refundRequests"][number];

const WINDOW_LENGTH_DAYS = REFUND_WINDOW_DAYS + 1;

/** Which day of the refund window a moment falls on; day 1 is the purchase day. */
function dayOfRefundWindow(purchasedAt: string, when: Date): number {
  const [py, pm, pd] = toCalendarDay(new Date(purchasedAt)).split("-").map(Number);
  const [wy, wm, wd] = toCalendarDay(when).split("-").map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;
  return (Date.UTC(wy, wm - 1, wd) - Date.UTC(py, pm - 1, pd)) / msPerDay + 1;
}

function formatWatched(seconds: number) {
  return formatDuration(Math.floor(seconds / 60), true, false, false);
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The suggested verdict, in the admin's words. It is only a suggestion. */
function describeVerdict(refundRequest: RequestedRefundRequest): string {
  const { verdict, now, lessonCount } = refundRequest;
  if (verdict.eligible) return "Eligible";

  switch (verdict.reason) {
    case "window-passed":
      return "Not eligible: sent after the refund window closed";
    case "watched-too-much":
      return `Not eligible: watched ${formatWatched(now.secondsWatched)}, over the 2-hour limit`;
    case "completed-too-much":
      return `Not eligible: completed ${now.completedLessonCount} of ${lessonCount} lessons, half or more`;
    case "claimed-team-seat":
      return "Not eligible: a claimed team seat";
    case "already-refunded":
      return "Not eligible: the student has already had a refund";
    default:
      return "Not eligible";
  }
}

function LimitCell({ value, overLimit }: { value: string; overLimit: boolean }) {
  return (
    <td
      className={
        overLimit
          ? "py-1 pr-4 font-medium text-amber-700 dark:text-amber-400"
          : "py-1 pr-4"
      }
    >
      {value}
      {overLimit && " ⚠"}
    </td>
  );
}

function RefundRequestCard({
  refundRequest,
}: {
  refundRequest: RequestedRefundRequest;
}) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    toast.success(
      fetcher.data.decision === RefundRequestStatus.Approved
        ? "Refund request approved."
        : "Refund request declined."
    );
  }, [fetcher.state, fetcher.data]);

  const { whenRequested, now, lessonCount, purchasedAt, requestedAt } =
    refundRequest;
  const halfOfLessons = Math.ceil(lessonCount / 2);
  const dayWhenRequested = dayOfRefundWindow(purchasedAt, new Date(requestedAt));
  const dayNow = dayOfRefundWindow(purchasedAt, new Date());
  const overWatch = (seconds: number) => seconds >= REFUND_WATCH_LIMIT_SECONDS;
  const overCompletion = (count: number) =>
    lessonCount > 0 && count / lessonCount >= REFUND_COMPLETION_LIMIT;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="font-semibold hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {refundRequest.studentName} · {refundRequest.studentEmail}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            Requested
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Refund of {formatPrice(refundRequest.amount)} · bought{" "}
          {formatDay(purchasedAt)} · requested {formatDay(requestedAt)}
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-medium"></th>
                <th className="py-1 pr-4 font-medium">When requested</th>
                <th className="py-1 pr-4 font-medium">Now</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="py-1 pr-4 font-medium">Refund window</th>
                <LimitCell
                  value={`day ${dayWhenRequested} of ${WINDOW_LENGTH_DAYS}`}
                  overLimit={dayWhenRequested > WINDOW_LENGTH_DAYS}
                />
                <td className="py-1 pr-4 text-muted-foreground">
                  day {dayNow} of {WINDOW_LENGTH_DAYS}
                </td>
              </tr>
              <tr>
                <th className="py-1 pr-4 font-medium">Time watched</th>
                <LimitCell
                  value={`${formatWatched(whenRequested.secondsWatched)} / 2h`}
                  overLimit={overWatch(whenRequested.secondsWatched)}
                />
                <LimitCell
                  value={`${formatWatched(now.secondsWatched)} / 2h`}
                  overLimit={overWatch(now.secondsWatched)}
                />
              </tr>
              <tr>
                <th className="py-1 pr-4 font-medium">Lessons completed</th>
                <LimitCell
                  value={`${whenRequested.completedLessonCount} / ${lessonCount} (half = ${halfOfLessons})`}
                  overLimit={overCompletion(whenRequested.completedLessonCount)}
                />
                <LimitCell
                  value={`${now.completedLessonCount} / ${lessonCount}`}
                  overLimit={overCompletion(now.completedLessonCount)}
                />
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          {refundRequest.studentHasHadRefund
            ? "This student has already had a refund."
            : "This student has not had a refund before."}
        </p>

        <p className="mt-2 text-sm">“{refundRequest.reason}”</p>

        <p
          className={
            refundRequest.verdict.eligible
              ? "mt-3 text-sm font-medium text-green-700 dark:text-green-400"
              : "mt-3 text-sm font-medium text-amber-700 dark:text-amber-400"
          }
        >
          Suggested: {describeVerdict(refundRequest)}
        </p>

        <fetcher.Form method="post" className="mt-4 flex gap-2">
          <input
            type="hidden"
            name="refundRequestId"
            value={refundRequest.id}
          />
          <Button
            type="submit"
            size="sm"
            name="decision"
            value={RefundRequestStatus.Approved}
            disabled={isSubmitting}
          >
            Approve
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            name="decision"
            value={RefundRequestStatus.Declined}
            disabled={isSubmitting}
          >
            Decline
          </Button>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function DecidedLog({
  refundRequests,
}: {
  refundRequests: Route.ComponentProps["loaderData"]["decidedRefundRequests"];
}) {
  if (refundRequests.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No refund requests have been decided yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Requested on</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Decided on</th>
              <th className="px-4 py-3 font-medium">Admin</th>
            </tr>
          </thead>
          <tbody>
            {refundRequests.map((refundRequest) => (
              <tr key={refundRequest.id} className="border-b last:border-0">
                <td className="px-4 py-3">{refundRequest.studentName}</td>
                <td className="px-4 py-3">{refundRequest.courseTitle}</td>
                <td className="px-4 py-3">
                  {formatDay(refundRequest.requestedAt)}
                </td>
                <td className="px-4 py-3">
                  {refundRequest.status === RefundRequestStatus.Approved
                    ? "Approved"
                    : "Declined"}
                </td>
                <td className="px-4 py-3">
                  {refundRequest.decidedAt
                    ? formatDay(refundRequest.decidedAt)
                    : "—"}
                </td>
                <td className="px-4 py-3">{refundRequest.adminName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
