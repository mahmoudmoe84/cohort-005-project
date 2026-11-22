// The shapes the analytics page renders. Plain data: every figure is already
// computed, so the page only formats and lays out.

export type RevenueSummary = {
  grossCents: number;
  feeCents: number;
  netCents: number;
  purchaseCount: number;
};

export type RevenuePoint = {
  bucket: string;
  grossCents: number;
  netCents: number;
};

export type RevenueSeries = {
  granularity: "day" | "month";
  points: RevenuePoint[];
};

export type StudentRevenue = {
  userId: number;
  name: string;
  revenueCents: number;
};

export type TopBuyer = {
  userId: number;
  name: string;
  email: string;
  spendCents: number;
  purchaseCount: number;
  seatsBought: number;
  seatsUnredeemed: number;
  enrolled: boolean;
};

export type RatingSummary = {
  average: number | null;
  count: number;
};

export type CourseProgressSummary = {
  enrolledCount: number;
  totalLessons: number;
  averageProgressPercent: number | null;
  finishedCount: number;
};

export type FunnelLesson = {
  lessonId: number;
  title: string;
  reachedCount: number;
  dropFromPrevious: number;
};

export type FunnelModule = {
  moduleId: number;
  title: string;
  reachedCount: number;
  dropWithin: number;
  lessons: FunnelLesson[];
};

export type CourseFunnel = {
  enrolledCount: number;
  modules: FunnelModule[];
};

export type QuizPassRate = {
  quizId: number;
  title: string;
  moduleTitle: string;
  lessonTitle: string;
  passingScorePercent: number;
  studentCount: number;
  passedCount: number;
  passRatePercent: number | null;
  averageBestScorePercent: number | null;
};

export type CountryRevenueRow = {
  country: string | null;
  purchaseCount: number;
  grossCents: number;
  netCents: number;
  sharePercent: number;
  averagePaidCents: number;
  discountPercent: number | null;
};

export type CourseCountryRevenue = {
  grossCents: number;
  netCents: number;
  purchaseCount: number;
  discountedGrossCents: number;
  discountedNetCents: number;
  discountedSharePercent: number;
  rows: CountryRevenueRow[];
};
/**
 * Unanswered questions, split rather than filtered: the range applies, but
 * questions older than it are still reported, because months of silence is
 * the urgent case.
 */
export type UnansweredQuestions = {
  inRange: number;
  older: number;
};

export type CourseRevenue = {
  courseId: number;
  title: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  purchaseCount: number;
};

export type Audience = {
  buyerCount: number;
  studentCount: number;
  revenuePerStudentCents: number | null;
};

export type CourseOption = {
  courseId: number;
  title: string;
};

export type InstructorOption = {
  id: number;
  name: string;
};
