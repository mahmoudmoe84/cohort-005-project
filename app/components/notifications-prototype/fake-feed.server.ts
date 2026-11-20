// PROTOTYPE, throwaway. Builds a pretend Notification Feed for the signed-in
// person out of real seed rows, so every Notification links to a real page.
// Where the seed is thin, it pads with made-up Notifications about real
// courses, lessons and people. Nothing is written anywhere.
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  comments,
  coupons,
  courses,
  CourseStatus,
  enrollments,
  lessons,
  modules,
  purchases,
  refunds,
  RefundStatus,
  teamMembers,
  TeamMemberRole,
  UserRole,
  users,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";
import type {
  NotificationKind,
  PrototypeFeed,
  PrototypeNotification,
} from "./types";

type Draft = Omit<PrototypeNotification, "insertedAt" | "seenAt" | "readAt">;

// Minutes ago, newest first, for the starting feed.
const AGES = [
  3,
  41,
  160,
  60 * 19,
  60 * 27,
  60 * 50,
  60 * 24 * 4,
  60 * 24 * 6,
  60 * 24 * 11,
  60 * 24 * 16,
];
const STARTS_UNREAD = 3;
const STARTS_UNSEEN = 2;

const QUESTIONS = [
  "Why does the compiler widen my literal type here when I use let instead of const?",
  "The video runs the migration before seeding, but the README says seed first. Which order is right?",
  "At 6:42 I get a different result locally. Has the library API changed since this was recorded?",
  "Could you share the finished code for this lesson? The GitHub link goes to the previous lesson's branch.",
  "Would you wrap this in a try/catch in production, or let the error bubble up to the route?",
];

const REPLIES = [
  "Good catch. The README is out of date: run the migration first, then seed.",
  "That's widening: let gives you string, const keeps the literal. Annotate it if you need the literal type.",
  "The API changed in v3. I've added a note under the video with the new call.",
  "Same thing happened to me. Restarting the dev server after clearing the cache fixed it.",
];

// Made-up people claiming the last Unclaimed Seats.
const FAKE_COLLEAGUES = ["Noah Fischer", "Hana Sato", "Diego Alvarez"];

const REFUND_REASONS = [
  "I bought the wrong course. I meant to get the advanced one.",
  "It's more introductory than the description suggested.",
  "My employer bought a Team Licence, so I don't need my own Purchase.",
  "I don't have time to take it this year.",
];

// Deterministic per person, so a reload shows the same feed.
function randomFor(seed: number) {
  let a = seed * 9973 + 17;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function lessonUrl(courseSlug: string, lessonId: number) {
  return `/courses/${courseSlug}/lessons/${lessonId}`;
}

// ─── Queries over the seed ───

function openRefundRequests() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      amountPaid: purchases.amountPaid,
      buyerName: users.name,
      buyerAvatarUrl: users.avatarUrl,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
    .innerJoin(users, eq(users.id, purchases.userId))
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(refunds.status, RefundStatus.Open))
    .orderBy(desc(refunds.requestedAt))
    .all();
}

function somePurchases(limit: number) {
  return db
    .select({
      id: purchases.id,
      amountPaid: purchases.amountPaid,
      buyerName: users.name,
      buyerAvatarUrl: users.avatarUrl,
      courseTitle: courses.title,
    })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.userId))
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(users.role, UserRole.Student))
    .orderBy(desc(purchases.createdAt))
    .limit(limit)
    .all();
}

function myRefundRequests(userId: number) {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      decisionNote: refunds.decisionNote,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refunds.requestedAt))
    .all();
}

function discussionQuestionsOnMyCourses(instructorId: number) {
  const author = alias(users, "author");
  return db
    .select({
      id: comments.id,
      body: comments.body,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      authorName: author.name,
      authorAvatarUrl: author.avatarUrl,
    })
    .from(comments)
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .innerJoin(author, eq(author.id, comments.userId))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        isNull(comments.parentId),
        isNull(comments.deletedAt),
        ne(comments.userId, instructorId)
      )
    )
    .orderBy(desc(comments.createdAt))
    .all();
}

function discussionRepliesToMyQuestions(userId: number) {
  const question = alias(comments, "question");
  const replier = alias(users, "replier");
  return db
    .select({
      id: comments.id,
      body: comments.body,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      replierName: replier.name,
      replierAvatarUrl: replier.avatarUrl,
    })
    .from(comments)
    .innerJoin(question, eq(question.id, comments.parentId))
    .innerJoin(replier, eq(replier.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(
      and(
        eq(question.userId, userId),
        isNull(question.parentId),
        ne(comments.userId, userId),
        isNull(comments.deletedAt)
      )
    )
    .orderBy(desc(comments.createdAt))
    .all();
}

function lessonsOnMyCourses(instructorId: number) {
  return db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        eq(courses.status, CourseStatus.Published)
      )
    )
    .all();
}

function studentsOn(courseIds: number[]) {
  if (courseIds.length === 0) return [];
  return db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(inArray(enrollments.courseId, courseIds))
    .limit(40)
    .all();
}

function lessonsOnMyEnrollments(userId: number) {
  const instructor = alias(users, "instructor");
  return db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorName: instructor.name,
      instructorAvatarUrl: instructor.avatarUrl,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(instructor, eq(instructor.id, courses.instructorId))
    .innerJoin(modules, eq(modules.courseId, courses.id))
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(eq(enrollments.userId, userId))
    .all();
}

function seatsOnMyTeamLicences(userId: number) {
  const teamIds = db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .all()
    .map((row) => row.teamId);
  if (teamIds.length === 0) return [];

  const claimant = alias(users, "claimant");
  return db
    .select({
      purchaseId: coupons.purchaseId,
      redeemedAt: coupons.redeemedAt,
      refundedAt: coupons.refundedAt,
      courseTitle: courses.title,
      claimantName: claimant.name,
      claimantAvatarUrl: claimant.avatarUrl,
    })
    .from(coupons)
    .innerJoin(courses, eq(courses.id, coupons.courseId))
    .leftJoin(claimant, eq(claimant.id, coupons.redeemedByUserId))
    .where(inArray(coupons.teamId, teamIds))
    .all();
}

// ─── Drafts per kind of Notification ───

function openRefundRequestDraft(
  id: string,
  row: {
    reason: string;
    amountPaid: number;
    buyerName: string;
    buyerAvatarUrl: string | null;
    courseTitle: string;
  }
): Draft {
  return {
    id,
    kind: "open-refund-request",
    actor: { name: row.buyerName, avatarUrl: row.buyerAvatarUrl },
    summary: [
      { text: row.buyerName, strong: true },
      { text: " asked for a refund on " },
      { text: row.courseTitle, strong: true },
      { text: ` (${formatPrice(row.amountPaid)})` },
    ],
    excerpt: row.reason,
    context: row.courseTitle,
    url: "/admin/refunds",
    alwaysDelivered: false,
  };
}

function refundDecidedDraft(
  id: string,
  row: {
    status: RefundStatus;
    decisionNote: string | null;
    amountPaid: number;
    courseTitle: string;
  }
): Draft {
  const approved = row.status !== RefundStatus.Declined;
  return {
    id,
    kind: "refund-request-decided",
    actor: null,
    summary: approved
      ? [
          { text: "Your Refund Request for " },
          { text: row.courseTitle, strong: true },
          { text: " was approved. " },
          { text: formatPrice(row.amountPaid), strong: true },
          { text: " is on its way back to you." },
        ]
      : [
          { text: "Your Refund Request for " },
          { text: row.courseTitle, strong: true },
          { text: " was declined." },
        ],
    excerpt: row.decisionNote,
    context: row.courseTitle,
    url: "/settings",
    alwaysDelivered: true,
  };
}

function discussionQuestionDraft(
  id: string,
  row: {
    body: string;
    lessonId: number;
    lessonTitle: string;
    courseTitle: string;
    courseSlug: string;
    authorName: string;
    authorAvatarUrl: string | null;
  }
): Draft {
  return {
    id,
    kind: "discussion-question",
    actor: { name: row.authorName, avatarUrl: row.authorAvatarUrl },
    summary: [
      { text: row.authorName, strong: true },
      { text: " asked a Discussion Question on " },
      { text: row.lessonTitle, strong: true },
    ],
    excerpt: row.body,
    context: row.courseTitle,
    url: lessonUrl(row.courseSlug, row.lessonId),
    alwaysDelivered: false,
  };
}

function discussionReplyDraft(
  id: string,
  row: {
    body: string;
    lessonId: number;
    lessonTitle: string;
    courseTitle: string;
    courseSlug: string;
    replierName: string;
    replierAvatarUrl: string | null;
  }
): Draft {
  return {
    id,
    kind: "discussion-reply",
    actor: { name: row.replierName, avatarUrl: row.replierAvatarUrl },
    summary: [
      { text: row.replierName, strong: true },
      { text: " replied to your Discussion Question on " },
      { text: row.lessonTitle, strong: true },
    ],
    excerpt: row.body,
    context: row.courseTitle,
    url: lessonUrl(row.courseSlug, row.lessonId),
    alwaysDelivered: false,
  };
}

function seatClaimedDraft(
  id: string,
  row: {
    courseTitle: string;
    claimantName: string;
    claimantAvatarUrl: string | null;
    seatsLeft: number;
    seatsTotal: number;
  }
): Draft {
  return {
    id,
    kind: "seat-claimed",
    actor: { name: row.claimantName, avatarUrl: row.claimantAvatarUrl },
    summary: [
      { text: row.claimantName, strong: true },
      { text: " claimed a Seat on " },
      { text: row.courseTitle, strong: true },
      {
        text: `. ${row.seatsLeft} of ${row.seatsTotal} Seats left.`,
      },
    ],
    excerpt: null,
    context: row.courseTitle,
    url: "/team",
    alwaysDelivered: false,
  };
}

// ─── The feed ───

export function buildPrototypeFeed(userId: number): PrototypeFeed {
  const me = db.select().from(users).where(eq(users.id, userId)).get();
  if (!me) return { feed: [], upcoming: [] };

  const random = randomFor(userId);
  const byKind = new Map<NotificationKind, Draft[]>();
  const upcoming: Draft[] = [];
  const add = (draft: Draft) => {
    byKind.set(draft.kind, [...(byKind.get(draft.kind) ?? []), draft]);
  };

  // Platform Admin: every new Open Refund Request.
  if (me.role === UserRole.Admin) {
    openRefundRequests().forEach((row) =>
      add(openRefundRequestDraft(`refund-${row.id}`, row))
    );
    const pastPurchases = somePurchases(12);
    pastPurchases.slice(0, 3).forEach((row) =>
      add(
        openRefundRequestDraft(`pad-refund-${row.id}`, {
          ...row,
          reason: pick(REFUND_REASONS, random),
        })
      )
    );
    pastPurchases.slice(6, 8).forEach((row) =>
      upcoming.push(
        openRefundRequestDraft(`live-refund-${row.id}`, {
          ...row,
          reason: pick(REFUND_REASONS, random),
        })
      )
    );
  }

  // Instructor: every new Discussion Question on their courses.
  if (me.role === UserRole.Instructor) {
    const real = discussionQuestionsOnMyCourses(me.id);
    real.forEach((row) =>
      add(discussionQuestionDraft(`question-${row.id}`, row))
    );
    const myLessons = lessonsOnMyCourses(me.id);
    const students = studentsOn([...new Set(myLessons.map((l) => l.courseId))]);
    if (myLessons.length > 0 && students.length > 0) {
      const fake = (id: string) => {
        const lesson = pick(myLessons, random);
        const student = pick(students, random);
        return discussionQuestionDraft(id, {
          ...lesson,
          body: pick(QUESTIONS, random),
          authorName: student.name,
          authorAvatarUrl: student.avatarUrl,
        });
      };
      for (let i = real.length; i < 6; i++) add(fake(`pad-question-${i}`));
      for (let i = 0; i < 3; i++) upcoming.push(fake(`live-question-${i}`));
    }
  }

  // Anyone who asked a Discussion Question: every Discussion Reply to it.
  const realReplies = discussionRepliesToMyQuestions(me.id);
  realReplies.forEach((row) =>
    add(discussionReplyDraft(`reply-${row.id}`, row))
  );
  if (me.role === UserRole.Student) {
    const myLessons = lessonsOnMyEnrollments(me.id);
    if (myLessons.length > 0) {
      const fake = (id: string) => {
        const lesson = pick(myLessons, random);
        return discussionReplyDraft(id, {
          ...lesson,
          body: pick(REPLIES, random),
          replierName: lesson.instructorName,
          replierAvatarUrl: lesson.instructorAvatarUrl,
        });
      };
      for (let i = realReplies.length; i < 2; i++) add(fake(`pad-reply-${i}`));
      for (let i = 0; i < 2; i++) upcoming.push(fake(`live-reply-${i}`));
    }
  }

  // Team Admin: every Seat claimed on their Team Licences.
  const seats = seatsOnMyTeamLicences(me.id);
  const licences = new Map<number, typeof seats>();
  seats.forEach((seat) =>
    licences.set(seat.purchaseId, [...(licences.get(seat.purchaseId) ?? []), seat])
  );
  licences.forEach((licenceSeats, purchaseId) => {
    const total = licenceSeats.length;
    const claimed = licenceSeats
      .filter((seat) => seat.redeemedAt && seat.claimantName)
      .sort((a, b) => (a.redeemedAt! < b.redeemedAt! ? -1 : 1));
    claimed
      .map((seat, i) =>
        seatClaimedDraft(`seat-${purchaseId}-${i}`, {
          courseTitle: seat.courseTitle,
          claimantName: seat.claimantName!,
          claimantAvatarUrl: seat.claimantAvatarUrl,
          seatsLeft: total - (i + 1),
          seatsTotal: total,
        })
      )
      .reverse()
      .forEach(add);
    const unclaimed = licenceSeats.filter(
      (seat) => !seat.redeemedAt && !seat.refundedAt
    ).length;
    if (unclaimed > 0) {
      const newcomer = pick(FAKE_COLLEAGUES, random);
      upcoming.push(
        seatClaimedDraft(`live-seat-${purchaseId}`, {
          courseTitle: licenceSeats[0].courseTitle,
          claimantName: newcomer,
          claimantAvatarUrl: null,
          seatsLeft: unclaimed - 1,
          seatsTotal: total,
        })
      );
    }
  });

  // Buyer: their Refund Request decided. Open ones arrive live, decided.
  myRefundRequests(me.id).forEach((row) => {
    if (row.status === RefundStatus.Open) {
      upcoming.unshift(
        refundDecidedDraft(`live-decision-${row.id}`, {
          ...row,
          status: RefundStatus.Approved,
        })
      );
    } else {
      add(refundDecidedDraft(`decision-${row.id}`, row));
    }
  });

  // Interleave the kinds so the feed reads like real life, newest first.
  const queues = [...byKind.values()];
  const drafts: Draft[] = [];
  while (drafts.length < AGES.length && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && drafts.length < AGES.length) drafts.push(next);
    }
  }

  const now = Date.now();
  const feed = drafts.map((draft, i) => {
    const insertedAt = new Date(now - AGES[i] * 60_000).toISOString();
    return {
      ...draft,
      insertedAt,
      seenAt: i < STARTS_UNSEEN ? null : insertedAt,
      readAt: i < STARTS_UNREAD ? null : insertedAt,
    };
  });

  return {
    feed,
    upcoming: upcoming.map((draft) => ({
      ...draft,
      insertedAt: new Date(now).toISOString(),
      seenAt: null,
      readAt: null,
    })),
  };
}

