import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { TeamMemberRole, UserRole } from "~/db/schema";
import { outboxTransport } from "~/lib/mailer.server";
import {
  createFakeNotificationProvider,
  type NotificationProvider,
} from "./notification-provider.server";
import {
  notifyDiscussionReply,
  notifyRefundRequestDecided,
} from "./notifications.server";
import {
  approveRefundRequest,
  declineRefundRequest,
  raiseRefundRequest,
} from "./refunds.server";

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

describe("notifyRefundRequestDecided", () => {
  let platformAdmin: typeof schema.users.$inferSelect;

  beforeEach(() => {
    platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Alex Rivera",
        email: "alex@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
  });

  // An Individual Purchase: the buyer gets an Enrollment.
  function buyForSelf(buyerId: number, amountPaid = 7900) {
    const purchase = db
      .insert(schema.purchases)
      .values({ userId: buyerId, courseId: base.course.id, amountPaid })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: buyerId, courseId: base.course.id })
      .run();
    return purchase;
  }

  // A Team Licence: Seats for others to claim, and no Enrollment for the Team
  // Admin who bought it.
  function buySeats(teamAdminId: number, seats: number) {
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: teamAdminId,
        role: TeamMemberRole.Admin,
      })
      .run();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: teamAdminId,
        courseId: base.course.id,
        amountPaid: 7900 * seats,
      })
      .returning()
      .get();
    for (let seat = 1; seat <= seats; seat++) {
      db.insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: `SEAT-${purchase.id}-${seat}`,
          purchaseId: purchase.id,
        })
        .run();
    }
    return purchase;
  }

  function raise(purchaseId: number, buyerId: number) {
    const result = raiseRefundRequest(
      db,
      purchaseId,
      buyerId,
      "It was more introductory than I expected.",
      new Date()
    );
    if (!result.ok) throw new Error(result.error);
    return result.refundRequestId;
  }

  function approve(refundRequestId: number, note: string | null = null) {
    const result = approveRefundRequest(
      db,
      refundRequestId,
      platformAdmin.id,
      note,
      new Date()
    );
    if (!result.ok) throw new Error(result.error);
  }

  function decline(refundRequestId: number, note: string) {
    const result = declineRefundRequest(
      db,
      refundRequestId,
      platformAdmin.id,
      note,
      new Date()
    );
    if (!result.ok) throw new Error(result.error);
  }

  it("tells the buyer once that their Refund Request was decided", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      {
        kind: "refund-request-decided",
        recipients: [{ id: liam.id, email: "liam@example.com" }],
      },
    ]);
  });

  it("is signed by Cadence and says how much is on its way back once approved", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyForSelf(liam.id, 7900).id, liam.id);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      {
        actor: null,
        content: {
          summary: [
            { text: "Your Refund Request for " },
            { text: "Test Course", strong: true },
            { text: " was approved. " },
            { text: "$79.00", strong: true },
            { text: " is on its way back to you." },
          ],
          excerpt: null,
          context: "Test Course",
        },
      },
    ]);
  });

  it("says it was declined, with the Platform Admin's note as the excerpt", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
    decline(refundRequestId, "You've finished more than half the course.");

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      {
        actor: null,
        content: {
          summary: [
            { text: "Your Refund Request for " },
            { text: "Test Course", strong: true },
            { text: " was declined." },
          ],
          excerpt: "You've finished more than half the course.",
          context: "Test Course",
        },
      },
    ]);
  });

  it("links to the buyer's Refund Requests in settings", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      { content: { url: "/settings#refund-requests" } },
    ]);
  });

  it("goes to the Team Admin who bought a Team Licence", async () => {
    const provider = createFakeNotificationProvider();
    const teamAdmin = addStudent("Ava Nakamura");
    const teamLicence = buySeats(teamAdmin.id, 3);
    const refundRequestId = raise(teamLicence.id, teamAdmin.id);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      { recipients: [{ id: teamAdmin.id, email: "ava@example.com" }] },
    ]);
  });

  it("sends nothing when the Platform Admin decided their own Refund Request", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(
      buyForSelf(platformAdmin.id).id,
      platformAdmin.id
    );
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toEqual([]);
  });

  it("sends nothing while the Refund Request is still open", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toEqual([]);
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
    const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
    approve(refundRequestId);

    await expect(
      notifyRefundRequestDecided(db, refundRequestId, failingProvider)
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`Refund Request ${refundRequestId}`),
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

    // It carries the money details, so the switch can't stop it.
    it("goes by email even while the buyer's switch is off", async () => {
      const provider = createFakeNotificationProvider();
      turnOffEmailAndPopUps(liam.id);
      const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
      approve(refundRequestId);

      await notifyRefundRequestDecided(db, refundRequestId, provider);

      expect(provider.sent).toMatchObject([
        {
          recipients: [{ id: liam.id, email: "liam@example.com" }],
          content: {
            email: {
              subject: "Your Refund Request for Test Course was approved",
            },
          },
        },
      ]);
    });

    it("says how much is on its way back and links to the buyer's Refund Requests", async () => {
      const provider = createFakeNotificationProvider();
      const refundRequestId = raise(buyForSelf(liam.id, 7900).id, liam.id);
      approve(refundRequestId);

      await notifyRefundRequestDecided(db, refundRequestId, provider);

      const [send] = provider.sent;
      expect(send.content.email).toEqual({
        subject: "Your Refund Request for Test Course was approved",
        body: [
          "Hi Liam Thompson,",
          "",
          'Your Refund Request for "Test Course" was approved. $79.00 is on its way back to you.',
          "",
          "See your Refund Requests on Cadence: https://cadence.test/settings#refund-requests",
          "",
          "— The Cadence team",
        ].join("\n"),
      });
    });

    it("gives the Platform Admin's note on a decline, and says what the buyer can do next", async () => {
      const provider = createFakeNotificationProvider();
      const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
      decline(refundRequestId, "You've finished more than half the course.");

      await notifyRefundRequestDecided(db, refundRequestId, provider);

      const [send] = provider.sent;
      expect(send.content.email).toEqual({
        subject: "Your Refund Request for Test Course was declined",
        body: [
          "Hi Liam Thompson,",
          "",
          'Your Refund Request for "Test Course" was declined.',
          "",
          "You've finished more than half the course.",
          "",
          "You still have everything you bought. If something changes, you can raise a new Refund Request.",
          "",
          "See your Refund Requests on Cadence: https://cadence.test/settings#refund-requests",
          "",
          "— The Cadence team",
        ].join("\n"),
      });
    });

    it("passes on a note the Platform Admin left on an approval, in-app and by email", async () => {
      const provider = createFakeNotificationProvider();
      const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
      approve(refundRequestId, "Sorry it wasn't the right fit.");

      await notifyRefundRequestDecided(db, refundRequestId, provider);

      expect(provider.sent).toMatchObject([
        {
          content: {
            excerpt: "Sorry it wasn't the right fit.",
            email: {
              body: expect.stringContaining(
                "is on its way back to you.\n\nSorry it wasn't the right fit.\n"
              ),
            },
          },
        },
      ]);
    });

    // The switch can't stop this email, so there is nothing to turn off.
    it("has no footer linking to Notification settings", async () => {
      const provider = createFakeNotificationProvider();
      const refundRequestId = raise(buyForSelf(liam.id).id, liam.id);
      approve(refundRequestId);

      await notifyRefundRequestDecided(db, refundRequestId, provider);

      const [send] = provider.sent;
      expect(send.content.email?.body).not.toContain("Notification settings");
      expect(send.content.email?.body.split("\n").at(-1)).toBe(
        "— The Cadence team"
      );
    });
  });
});
