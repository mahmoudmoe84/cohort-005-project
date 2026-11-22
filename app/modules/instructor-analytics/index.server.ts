// ─── Instructor Analytics ───
// What an instructor earned, and when, read in one call. The route parses the
// request and decides who may see what; everything that touches the database
// is behind `getInstructorAnalytics`.
//
// The range vocabulary (`AnalyticsRange`, `rangeStart`, money formatting) is
// the sibling entry point `config.ts`, which is safe to import from the page.

import type { AnalyticsRange } from "./config";
import {
  getCourseDropOff,
  getCourseProgressSummary,
  getCourseQuizPassRates,
  getCourseRevenueByCountry,
} from "./lib/course";
import {
  getAudience,
  getCourseRevenue,
  getRatingSummary,
  getRevenueOverTime,
  getRevenueSummary,
  getTopBuyers,
  getUnansweredQuestions,
  hasPublishedCourse,
  listCourseOptions,
  listInstructors,
} from "./lib/overview";

export type * from "./lib/types";

export type InstructorAnalyticsQuery = {
  /** Whose figures. Null means platform-wide (every instructor). */
  instructorId: number | null;
  range: AnalyticsRange;
  /**
   * The course for the course tab, as requested. Untrusted: it is honoured
   * only if the course belongs to `instructorId`, so an instructor cannot
   * read another instructor's funnel by editing the URL.
   */
  courseId: number | null;
  /** Whether to list every Instructor, for the Platform Admin's instructor picker. */
  includeInstructors: boolean;
};

export function getInstructorAnalytics({
  instructorId,
  range,
  courseId,
  includeInstructors,
}: InstructorAnalyticsQuery) {
  const courseOptions = listCourseOptions(instructorId);
  const selectedCourseId = courseOptions.some(
    (course) => course.courseId === courseId
  )
    ? courseId
    : null;

  return {
    selectedCourseId,
    questions: getUnansweredQuestions(instructorId, range),
    audience: getAudience(instructorId, range),
    buyers: getTopBuyers(instructorId, range),
    ratings: getRatingSummary(instructorId, range),
    summary: getRevenueSummary(instructorId, range),
    series: getRevenueOverTime(instructorId, range),
    courses: getCourseRevenue(instructorId, range),
    courseOptions,
    // Progress and drop-off carry no usable timestamp, so they span all time
    // whatever the range control says — and the tab says so on screen.
    progress:
      selectedCourseId === null
        ? null
        : getCourseProgressSummary(selectedCourseId),
    funnel:
      selectedCourseId === null ? null : getCourseDropOff(selectedCourseId),
    // Quiz attempts and purchases are both timestamped, so unlike the two
    // panels above these do honour the range control.
    quizzes:
      selectedCourseId === null
        ? null
        : getCourseQuizPassRates(selectedCourseId, range),
    countries:
      selectedCourseId === null
        ? null
        : getCourseRevenueByCountry(selectedCourseId, range),
    instructors: includeInstructors ? listInstructors() : [],
    // The platform-wide view always has courses in it, so the "publish your
    // first course" prompt only makes sense for one named instructor.
    unpublished: instructorId !== null && !hasPublishedCourse(instructorId),
  };
}

export type InstructorAnalytics = ReturnType<typeof getInstructorAnalytics>;
