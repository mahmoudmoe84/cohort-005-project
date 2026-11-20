import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { outboxTransport } from "~/lib/mailer.server";
import {
  createFakeNotificationProvider,
  type NotificationProvider,
} from "./notification-provider.server";
import { notifyDiscussionReply } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;
let liam: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lesson = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Union Types", position: 1 })
    .returning()
    .get();

  liam = addStudent("Liam Thompson");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function addStudent(name: string) {
  const firstName = name.split(" ")[0].toLowerCase();
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${firstName}@example.com`,
      role: UserRole.Student,
      avatarUrl: `https://example.com/avatars/${firstName}.png`,
    })
    .returning()
    .get();
}

function postComment(authorId: number, body: string, parentId: number | null) {
  return db
    .insert(schema.comments)
    .values({ lessonId: lesson.id, userId: authorId, parentId, body })
    .returning()
    .get();
}

function askDiscussionQuestion(authorId: number, body: string) {
  return postComment(authorId, body, null);
}

function postDiscussionReply(
  authorId: number,
  discussionQuestionId: number,
  body: string
) {
  return postComment(authorId, body, discussionQuestionId);
}

// The schema's foreign keys stop a lesson with comments from being deleted, so
// they are switched off to stage a lesson that has gone.
function removeLesson() {
  db.$client.pragma("foreign_keys = OFF");
  db.delete(schema.lessons).where(eq(schema.lessons.id, lesson.id)).run();
  db.$client.pragma("foreign_keys = ON");
}

function readOutbox(directory: string) {
  return readdirSync(directory).map((file) =>
    JSON.parse(readFileSync(join(directory, file), "utf8"))
  );
}

// The switch on Notification settings, "Email and pop-ups for Notifications".
function turnOffEmailAndPopUps(userId: number) {
  db.update(schema.users)
    .set({ emailAndPopUps: false })
    .where(eq(schema.users.id, userId))
    .run();
}

describe("notifyDiscussionReply", () => {
  it("sends the Discussion Question's author one Discussion Reply Notification", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    const reply = postDiscussionReply(
      base.instructor.id,
      question.id,
      "Most of the time. Unions need no runtime code."
    );

    await notifyDiscussionReply(db, base.course.id, reply.id, provider);

    expect(provider.sent).toMatchObject([
      {
        kind: "discussion-reply",
        recipients: [{ id: liam.id, email: "liam@example.com" }],
      },
    ]);
  });

  it("says who replied on which lesson, quoting the Discussion Reply", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    const reply = postDiscussionReply(
      ava.id,
      question.id,
      "I switched to unions and never looked back."
    );

    await notifyDiscussionReply(db, base.course.id, reply.id, provider);

    expect(provider.sent).toMatchObject([
      {
        actor: {
          name: "Ava Nakamura",
          avatarUrl: "https://example.com/avatars/ava.png",
        },
        content: {
          summary: [
            { text: "Ava Nakamura", strong: true },
            { text: " replied to your Discussion Question on " },
            { text: "Union Types", strong: true },
          ],
          excerpt: "I switched to unions and never looked back.",
          context: "Test Course",
        },
      },
    ]);
  });

  it("links to the Discussion Reply on its lesson page", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    const reply = postDiscussionReply(
      base.instructor.id,
      question.id,
      "Most of the time. Unions need no runtime code."
    );

    await notifyDiscussionReply(db, base.course.id, reply.id, provider);

    expect(provider.sent).toMatchObject([
      {
        content: {
          url: `/courses/test-course/lessons/${lesson.id}#comment-${reply.id}`,
        },
      },
    ]);
  });

  it("sends nothing when the Discussion Question's author replies to it", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    const reply = postDiscussionReply(
      liam.id,
      question.id,
      "Answering myself: the TypeScript handbook covers it."
    );

    await notifyDiscussionReply(db, base.course.id, reply.id, provider);

    expect(provider.sent).toEqual([]);
  });

  it("sends nothing for a reply to the Instructor's own top-level comment, which isn't a Discussion Question", async () => {
    const provider = createFakeNotificationProvider();
    const announcement = postComment(
      base.instructor.id,
      "Heads up: the exercise files were updated this week.",
      null
    );
    const reply = postComment(
      liam.id,
      "Thanks for the heads up!",
      announcement.id
    );

    await notifyDiscussionReply(db, base.course.id, reply.id, provider);

    expect(provider.sent).toEqual([]);
  });

  it("falls back to the course when the lesson no longer exists", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    const reply = postDiscussionReply(
      base.instructor.id,
      question.id,
      "Most of the time. Unions need no runtime code."
    );
    removeLesson();

    await notifyDiscussionReply(db, base.course.id, reply.id, provider);

    expect(provider.sent).toMatchObject([
      {
        content: {
          summary: [
            { text: "Test Instructor", strong: true },
            { text: " replied to your Discussion Question on " },
            { text: "Test Course", strong: true },
          ],
          url: "/courses/test-course",
        },
      },
    ]);
  });

  it("logs a failed send and still returns normally", async () => {
    const failure = new Error("The Notification Provider is down");
    const failingProvider: NotificationProvider = {
      async send() {
        throw failure;
      },
      async feedCredentials(userId) {
        return { provider: "fake", userId };
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    const reply = postDiscussionReply(
      base.instructor.id,
      question.id,
      "Most of the time. Unions need no runtime code."
    );

    await expect(
      notifyDiscussionReply(db, base.course.id, reply.id, failingProvider)
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`comment ${reply.id}`),
      failure
    );
  });

  describe("by email", () => {
    beforeEach(() => {
      vi.stubEnv("APP_URL", "https://cadence.test");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("goes by email too while the author's switch is on", async () => {
      const provider = createFakeNotificationProvider();
      const ava = addStudent("Ava Nakamura");
      const question = askDiscussionQuestion(
        liam.id,
        "When should I reach for a union instead of an enum?"
      );
      const reply = postDiscussionReply(
        ava.id,
        question.id,
        "I switched to unions and never looked back."
      );

      await notifyDiscussionReply(db, base.course.id, reply.id, provider);

      expect(provider.sent).toMatchObject([
        {
          recipients: [{ id: liam.id, email: "liam@example.com" }],
          content: {
            email: {
              subject:
                "Ava Nakamura replied to your Discussion Question on Union Types",
            },
          },
        },
      ]);
    });

    it("goes in-app only while the author's switch is off", async () => {
      const provider = createFakeNotificationProvider();
      turnOffEmailAndPopUps(liam.id);
      const question = askDiscussionQuestion(
        liam.id,
        "When should I reach for a union instead of an enum?"
      );
      const reply = postDiscussionReply(
        base.instructor.id,
        question.id,
        "Most of the time. Unions need no runtime code."
      );

      await notifyDiscussionReply(db, base.course.id, reply.id, provider);

      expect(provider.sent).toMatchObject([
        {
          kind: "discussion-reply",
          recipients: [{ id: liam.id, email: "liam@example.com" }],
          content: {
            summary: [
              { text: "Test Instructor", strong: true },
              { text: " replied to your Discussion Question on " },
              { text: "Union Types", strong: true },
            ],
            excerpt: "Most of the time. Unions need no runtime code.",
            url: `/courses/test-course/lessons/${lesson.id}#comment-${reply.id}`,
          },
        },
      ]);
      expect(provider.sent.map((send) => send.content.email)).toEqual([
        undefined,
      ]);
    });

    it("ends with one footer line linking to Notification settings", async () => {
      const provider = createFakeNotificationProvider();
      const question = askDiscussionQuestion(
        liam.id,
        "When should I reach for a union instead of an enum?"
      );
      const reply = postDiscussionReply(
        base.instructor.id,
        question.id,
        "Most of the time. Unions need no runtime code."
      );

      await notifyDiscussionReply(db, base.course.id, reply.id, provider);

      const [send] = provider.sent;
      expect(send.content.email?.body.split("\n").slice(-3)).toEqual([
        "— The Cadence team",
        "",
        "To stop these emails, turn off email and pop-ups in Notification settings: https://cadence.test/settings/notifications",
      ]);
    });

    it("says who replied on which lesson, quotes the Discussion Reply and links to it", async () => {
      const provider = createFakeNotificationProvider();
      const ava = addStudent("Ava Nakamura");
      const question = askDiscussionQuestion(
        liam.id,
        "When should I reach for a union instead of an enum?"
      );
      const reply = postDiscussionReply(
        ava.id,
        question.id,
        "Most of the time.\n\nUnions need no runtime code."
      );

      await notifyDiscussionReply(db, base.course.id, reply.id, provider);

      const [send] = provider.sent;
      expect(send.content.email?.body).toBe(
        [
          "Hi Liam Thompson,",
          "",
          'Ava Nakamura replied to your Discussion Question on "Union Types" in "Test Course":',
          "",
          "> Most of the time.",
          ">",
          "> Unions need no runtime code.",
          "",
          `View it on Cadence: https://cadence.test/courses/test-course/lessons/${lesson.id}#comment-${reply.id}`,
          "",
          "— The Cadence team",
          "",
          "To stop these emails, turn off email and pop-ups in Notification settings: https://cadence.test/settings/notifications",
        ].join("\n")
      );
    });

    it("lands in the outbox under the fake Notification Provider", async () => {
      const outbox = mkdtempSync(join(tmpdir(), "outbox-"));
      const provider = createFakeNotificationProvider(outboxTransport(outbox));
      const ava = addStudent("Ava Nakamura");
      const question = askDiscussionQuestion(
        liam.id,
        "When should I reach for a union instead of an enum?"
      );
      const reply = postDiscussionReply(
        ava.id,
        question.id,
        "I switched to unions and never looked back."
      );

      await notifyDiscussionReply(db, base.course.id, reply.id, provider);

      expect(readOutbox(outbox)).toMatchObject([
        {
          to: "liam@example.com",
          subject:
            "Ava Nakamura replied to your Discussion Question on Union Types",
          body: expect.stringContaining(
            "> I switched to unions and never looked back."
          ),
        },
      ]);
    });
  });
});
