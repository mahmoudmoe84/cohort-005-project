import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import { sendRefundRequest } from "~/lib/refund-requests.server";
import { REFUND_INELIGIBLE_MESSAGES } from "~/lib/refund-requests";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

/**
 * The confirmation the student gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.studentEmail,
    subject: `Refund request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `If it is approved, your refund will be ${formatPrice(input.amount)}, the amount you paid.`,
      "",
      "An admin reviews every refund request by hand. You do not need to do anything else — we will email you again once it is approved or declined.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = db.select().from(courses).where(eq(courses.slug, slug)).get();

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const student = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!student) {
    throw data("User not found", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const result = sendRefundRequest(
    currentUserId,
    course.id,
    parsed.data.reason
  );

  if (!result.sent) {
    if (result.reason === "not-bought") {
      throw data("You have not bought this course.", { status: 403 });
    }
    throw data(REFUND_INELIGIBLE_MESSAGES[result.reason], {
      status: result.reason === "already-requested" ? 409 : 403,
    });
  }

  const email = buildRefundRequestEmail({
    studentName: student.name,
    studentEmail: student.email,
    courseTitle: course.title,
    amount: result.amount,
  });

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return redirect("/settings");
}
