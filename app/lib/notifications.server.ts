import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, users } from "~/db/schema";
import type { SummaryPart } from "~/lib/notifications";
import {
  configuredNotificationProvider,
  type NotificationProvider,
} from "~/lib/notification-provider.server";

// ─── Notifications ───
// Everything about Notifications except delivering them: who gets one, what it
// says and where it links. Delivery belongs to the Notification Provider
// (ADR 0013). There is one function per kind of Notification.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Db = BetterSQLite3Database<typeof schema>;

function getCommentWithAuthor(db: Db, commentId: number) {
  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      lessonId: comments.lessonId,
      body: comments.body,
      authorId: users.id,
      authorName: users.name,
      authorEmail: users.email,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.id, commentId))
    .get();
}

function getCourse(db: Db, courseId: number) {
  return db
    .select({
      title: courses.title,
      slug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
}

function getLesson(db: Db, lessonId: number) {
  return db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
}

// ─── Wording ───

type Course = { title: string; slug: string };
type Lesson = { id: number; title: string };

// Discussion Questions and Discussion Replies live on a lesson. If the lesson
// has gone, the Notification names the course and links to the course page.

function discussionReplySummary(
  replierName: string,
  course: Course,
  lesson: Lesson | undefined
): SummaryPart[] {
  return [
    { text: replierName, strong: true },
    { text: " replied to your Discussion Question on " },
    { text: lesson?.title ?? course.title, strong: true },
  ];
}

// Every comment on the lesson page carries an id="comment-<id>" anchor.
function discussionLink(
  course: Course,
  lesson: Lesson | undefined,
  commentId: number
): string {
  if (!lesson) return `/courses/${course.slug}`;
  return `/courses/${course.slug}/lessons/${lesson.id}#comment-${commentId}`;
}

// ─── One function per kind ───

/**
 * Tells a Discussion Question's author that someone posted a Discussion Reply
 * to it. Call it once the reply is saved. It never throws: a failure is logged,
 * so the reply still gets posted. The provider defaults to the configured one.
 */
export async function notifyDiscussionReply(
  db: Db,
  courseId: number,
  discussionReplyId: number,
  provider?: NotificationProvider
): Promise<void> {
  try {
    const reply = getCommentWithAuthor(db, discussionReplyId);
    if (!reply || reply.parentId === null) return;

    const question = getCommentWithAuthor(db, reply.parentId);
    const course = getCourse(db, courseId);
    const lesson = getLesson(db, reply.lessonId);
    if (!question || !course) return;

    // The Instructor's own top-level comment isn't a Discussion Question, so a
    // reply to it isn't a Discussion Reply.
    if (question.authorId === course.instructorId) return;

    // Nobody hears about their own action.
    if (question.authorId === reply.authorId) return;

    await (provider ?? configuredNotificationProvider()).send({
      kind: "discussion-reply",
      recipients: [{ id: question.authorId, email: question.authorEmail }],
      actor: { name: reply.authorName, avatarUrl: reply.authorAvatarUrl },
      content: {
        summary: discussionReplySummary(reply.authorName, course, lesson),
        excerpt: reply.body,
        context: course.title,
        url: discussionLink(course, lesson, reply.id),
      },
    });
  } catch (error) {
    console.error(
      `Couldn't send the Discussion Reply Notification for comment ${discussionReplyId}`,
      error
    );
  }
}
