import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, UserRole } from "~/db/schema";
import { outboxTransport } from "~/lib/mailer.server";
import {
  createFakeNotificationProvider,
  type FakeNotificationProvider,
  type NotificationProvider,
} from "./notification-provider.server";
import {
  markNotificationsRead,
  notifyDiscussionQuestion,
  notifyDiscussionReply,
  notifyOpenRefundRequest,
  notifyRefundRequestDecided,
  notifySeatClaimed,
} from "./notifications.server";
import { approveRefundRequest, declineRefundRequest } from "./refunds.server";

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

function addLesson(title: string) {
  return db
    .insert(schema.lessons)
    .values({ moduleId: lesson.moduleId, title, position: 2 })
    .returning()
    .get();
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

function addPlatformAdmin(name: string) {
  const firstName = name.split(" ")[0].toLowerCase();
  return db
    .insert(schema.users)
    .values({ name, email: `${firstName}@example.com`, role: UserRole.Admin })
    .returning()
    .get();
}

function buyCourse(buyerId: number, amountPaid: number) {
  return db
    .insert(schema.purchases)
    .values({ userId: buyerId, courseId: base.course.id, amountPaid })
    .returning()
    .get();
}

function raiseRefundRequest(purchaseId: number, reason: string) {
  return db
    .insert(schema.refunds)
    .values({ purchaseId, status: RefundStatus.Open, reason })
    .returning()
    .get();
}

function addTeam() {
  return db.insert(schema.teams).values({}).returning().get();
}

// Cadence gives a Team Admin one team, however many Team Licences they buy, so
// pass the first Team Licence's team when buying a second.
function buyTeamLicence(
  teamAdminId: number,
  seatCount: number,
  team = addTeam()
) {
  const purchase = buyCourse(teamAdminId, 7900 * seatCount);
  const seats = Array.from({ length: seatCount }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { team, seats };
}

function claimSeat(seatId: number, studentId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: studentId, redeemedAt: new Date().toISOString() })
    .where(eq(schema.coupons.id, seatId))
    .run();
}

// What the person's Notification Feed shows, newest first: each Notification's
// kind, and whether it's read.
function readStates(provider: FakeNotificationProvider, userId: number) {
  return provider
    .feedOf(userId)
    .page()
    .notifications.map(({ kind, readAt }) => ({ kind, read: readAt !== null }));
}

function failingProvider(failure: Error): NotificationProvider {
  return {
    async send() {
      throw failure;
    },
    async feedCredentials(userId) {
      return { provider: "fake", userId };
    },
    async markRead() {
      throw failure;
    },
  };
}

// Sends through the fake, but can't mark anything read.
function failingToMarkRead(
  provider: FakeNotificationProvider,
  failure: Error
): NotificationProvider {
  return {
    ...provider,
    async markRead() {
      throw failure;
    },
  };
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
      notifyDiscussionReply(
        db,
        base.course.id,
        reply.id,
        failingProvider(failure)
      )
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

describe("notifyDiscussionQuestion", () => {
  it("sends the course's Instructor one Discussion Question Notification", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );

    await notifyDiscussionQuestion(db, base.course.id, question.id, provider);

    expect(provider.sent).toMatchObject([
      {
        kind: "discussion-question",
        recipients: [
          { id: base.instructor.id, email: "instructor@example.com" },
        ],
      },
    ]);
  });

  it("says who asked on which lesson, quoting the Discussion Question", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );

    await notifyDiscussionQuestion(db, base.course.id, question.id, provider);

    expect(provider.sent).toMatchObject([
      {
        actor: {
          name: "Liam Thompson",
          avatarUrl: "https://example.com/avatars/liam.png",
        },
        content: {
          summary: [
            { text: "Liam Thompson", strong: true },
            { text: " asked a Discussion Question on " },
            { text: "Union Types", strong: true },
          ],
          excerpt: "When should I reach for a union instead of an enum?",
          context: "Test Course",
        },
      },
    ]);
  });

  it("links to the Discussion Question on its lesson page", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );

    await notifyDiscussionQuestion(db, base.course.id, question.id, provider);

    expect(provider.sent).toMatchObject([
      {
        content: {
          url: `/courses/test-course/lessons/${lesson.id}#comment-${question.id}`,
        },
      },
    ]);
  });

  it("sends nothing for the Instructor's own top-level comment, which isn't a Discussion Question", async () => {
    const provider = createFakeNotificationProvider();
    const announcement = postComment(
      base.instructor.id,
      "Heads up: the exercise files were updated this week.",
      null
    );

    await notifyDiscussionQuestion(
      db,
      base.course.id,
      announcement.id,
      provider
    );

    expect(provider.sent).toEqual([]);
  });

  it("sends nothing for a Discussion Reply, which isn't a Discussion Question", async () => {
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

    await notifyDiscussionQuestion(db, base.course.id, reply.id, provider);

    expect(provider.sent).toEqual([]);
  });

  it("falls back to the course when the lesson no longer exists", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    removeLesson();

    await notifyDiscussionQuestion(db, base.course.id, question.id, provider);

    expect(provider.sent).toMatchObject([
      {
        content: {
          summary: [
            { text: "Liam Thompson", strong: true },
            { text: " asked a Discussion Question on " },
            { text: "Test Course", strong: true },
          ],
          url: "/courses/test-course",
        },
      },
    ]);
  });

  it("logs a failed send and still returns normally", async () => {
    const failure = new Error("The Notification Provider is down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );

    await expect(
      notifyDiscussionQuestion(
        db,
        base.course.id,
        question.id,
        failingProvider(failure)
      )
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`comment ${question.id}`),
      failure
    );
  });
});

describe("notifyOpenRefundRequest", () => {
  it("tells every Platform Admin", async () => {
    const provider = createFakeNotificationProvider();
    const alex = addPlatformAdmin("Alex Rivera");
    const pat = addPlatformAdmin("Pat Admin");
    const purchase = buyCourse(liam.id, 7900);
    const refundRequest = raiseRefundRequest(
      purchase.id,
      "The pace is too fast for me."
    );

    await notifyOpenRefundRequest(db, refundRequest.id, provider);

    expect(provider.sent).toMatchObject([
      {
        kind: "open-refund-request",
        recipients: [
          { id: alex.id, email: "alex@example.com" },
          { id: pat.id, email: "pat@example.com" },
        ],
      },
    ]);
  });

  it("leaves out a Platform Admin who raised it on their own Purchase", async () => {
    const provider = createFakeNotificationProvider();
    const alex = addPlatformAdmin("Alex Rivera");
    const pat = addPlatformAdmin("Pat Admin");
    const purchase = buyCourse(pat.id, 7900);
    const refundRequest = raiseRefundRequest(
      purchase.id,
      "I bought it to check the checkout flow."
    );

    await notifyOpenRefundRequest(db, refundRequest.id, provider);

    expect(provider.sent).toMatchObject([
      { recipients: [{ id: alex.id, email: "alex@example.com" }] },
    ]);
  });

  it("sends nothing when the only Platform Admin raised it", async () => {
    const provider = createFakeNotificationProvider();
    const pat = addPlatformAdmin("Pat Admin");
    const purchase = buyCourse(pat.id, 7900);
    const refundRequest = raiseRefundRequest(
      purchase.id,
      "I bought it to check the checkout flow."
    );

    await notifyOpenRefundRequest(db, refundRequest.id, provider);

    expect(provider.sent).toEqual([]);
  });

  it("says who asked for how much back on which course, quoting their reason", async () => {
    const provider = createFakeNotificationProvider();
    addPlatformAdmin("Alex Rivera");
    const purchase = buyCourse(liam.id, 7900);
    const refundRequest = raiseRefundRequest(
      purchase.id,
      "The pace is too fast for me."
    );

    await notifyOpenRefundRequest(db, refundRequest.id, provider);

    expect(provider.sent).toMatchObject([
      {
        actor: {
          name: "Liam Thompson",
          avatarUrl: "https://example.com/avatars/liam.png",
        },
        content: {
          summary: [
            { text: "Liam Thompson", strong: true },
            { text: " asked for a refund on " },
            { text: "Test Course", strong: true },
            { text: " ($79.00)" },
          ],
          excerpt: "The pace is too fast for me.",
          context: "Test Course",
        },
      },
    ]);
  });

  it("links to the Refund Request review page", async () => {
    const provider = createFakeNotificationProvider();
    addPlatformAdmin("Alex Rivera");
    const purchase = buyCourse(liam.id, 7900);
    const refundRequest = raiseRefundRequest(
      purchase.id,
      "The pace is too fast for me."
    );

    await notifyOpenRefundRequest(db, refundRequest.id, provider);

    expect(provider.sent).toMatchObject([
      { content: { url: "/admin/refunds" } },
    ]);
  });

  it("logs a failed send and still returns normally", async () => {
    const failure = new Error("The Notification Provider is down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    addPlatformAdmin("Alex Rivera");
    const purchase = buyCourse(liam.id, 7900);
    const refundRequest = raiseRefundRequest(
      purchase.id,
      "The pace is too fast for me."
    );

    await expect(
      notifyOpenRefundRequest(db, refundRequest.id, failingProvider(failure))
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`Refund Request ${refundRequest.id}`),
      failure
    );
  });
});

describe("notifySeatClaimed", () => {
  it("tells the Team Admin who bought the Team Licence", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 3);
    claimSeat(seats[0].id, liam.id);

    await notifySeatClaimed(db, seats[0].id, provider);

    expect(provider.sent).toMatchObject([
      {
        kind: "seat-claimed",
        recipients: [{ id: ava.id, email: "ava@example.com" }],
      },
    ]);
  });

  it("says who claimed a Seat on which course, and how many Seats are left", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 5);
    claimSeat(seats[0].id, addStudent("James Park").id);
    claimSeat(seats[1].id, addStudent("Sophia Davis").id);
    claimSeat(seats[2].id, liam.id);

    await notifySeatClaimed(db, seats[2].id, provider);

    expect(provider.sent).toMatchObject([
      {
        actor: {
          name: "Liam Thompson",
          avatarUrl: "https://example.com/avatars/liam.png",
        },
        content: {
          summary: [
            { text: "Liam Thompson", strong: true },
            { text: " claimed a Seat on " },
            { text: "Test Course", strong: true },
            { text: ". 2 of 5 Seats left." },
          ],
          excerpt: null,
          context: "Test Course",
        },
      },
    ]);
  });

  it("counts only the Seats on that Team Licence", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const firstLicence = buyTeamLicence(ava.id, 2);
    const { seats } = buyTeamLicence(ava.id, 5, firstLicence.team);
    claimSeat(seats[0].id, liam.id);

    await notifySeatClaimed(db, seats[0].id, provider);

    expect(provider.sent).toMatchObject([
      {
        content: {
          summary: [
            { text: "Liam Thompson", strong: true },
            { text: " claimed a Seat on " },
            { text: "Test Course", strong: true },
            { text: ". 4 of 5 Seats left." },
          ],
        },
      },
    ]);
  });

  it("speaks of one Seat on a Team Licence of one", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 1);
    claimSeat(seats[0].id, liam.id);

    await notifySeatClaimed(db, seats[0].id, provider);

    expect(provider.sent).toMatchObject([
      {
        content: {
          summary: [
            { text: "Liam Thompson", strong: true },
            { text: " claimed a Seat on " },
            { text: "Test Course", strong: true },
            { text: ". 0 of 1 Seat left." },
          ],
        },
      },
    ]);
  });

  it("sends nothing when the Team Admin claims one of their own Seats", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 3);
    claimSeat(seats[0].id, ava.id);

    await notifySeatClaimed(db, seats[0].id, provider);

    expect(provider.sent).toEqual([]);
  });

  it("links to the team page", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 3);
    claimSeat(seats[0].id, liam.id);

    await notifySeatClaimed(db, seats[0].id, provider);

    expect(provider.sent).toMatchObject([{ content: { url: "/team" } }]);
  });

  it("logs a failed send and still returns normally", async () => {
    const failure = new Error("The Notification Provider is down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 3);
    claimSeat(seats[0].id, liam.id);

    await expect(
      notifySeatClaimed(db, seats[0].id, failingProvider(failure))
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`Seat ${seats[0].id}`),
      failure
    );
  });
});

describe("notifyRefundRequestDecided", () => {
  let platformAdmin: typeof schema.users.$inferSelect;

  beforeEach(() => {
    platformAdmin = addPlatformAdmin("Alex Rivera");
  });

  function raise(purchaseId: number) {
    return raiseRefundRequest(
      purchaseId,
      "It was more introductory than I expected."
    ).id;
  }

  // Decided the way the Refund Request review page decides them.
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
    const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
    const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
    const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
    const refundRequestId = raise(buyCourse(liam.id, 7900).id);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      { content: { url: "/settings#refund-requests" } },
    ]);
  });

  it("goes to the Team Admin who bought a Team Licence", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 3);
    const refundRequestId = raise(seats[0].purchaseId);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toMatchObject([
      { recipients: [{ id: ava.id, email: "ava@example.com" }] },
    ]);
  });

  it("sends nothing when the Platform Admin decided their own Refund Request", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyCourse(platformAdmin.id, 7900).id);
    approve(refundRequestId);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toEqual([]);
  });

  it("sends nothing while the Refund Request is still open", async () => {
    const provider = createFakeNotificationProvider();
    const refundRequestId = raise(buyCourse(liam.id, 7900).id);

    await notifyRefundRequestDecided(db, refundRequestId, provider);

    expect(provider.sent).toEqual([]);
  });

  it("logs a failed send and still returns normally", async () => {
    const failure = new Error("The Notification Provider is down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const refundRequestId = raise(buyCourse(liam.id, 7900).id);
    approve(refundRequestId);

    await expect(
      notifyRefundRequestDecided(db, refundRequestId, failingProvider(failure))
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
      const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
      const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
      const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
      const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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
      const refundRequestId = raise(buyCourse(liam.id, 7900).id);
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

describe("markNotificationsRead", () => {
  it("marks a Discussion Reply Notification read when its recipient opens the lesson", async () => {
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

    await markNotificationsRead(
      db,
      liam.id,
      { page: "lesson", lessonId: lesson.id },
      provider
    );

    expect(readStates(provider, liam.id)).toEqual([
      { kind: "discussion-reply", read: true },
    ]);
  });

  it("marks a Discussion Question Notification read when the Instructor opens the lesson", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    await notifyDiscussionQuestion(db, base.course.id, question.id, provider);

    await markNotificationsRead(
      db,
      base.instructor.id,
      { page: "lesson", lessonId: lesson.id },
      provider
    );

    expect(readStates(provider, base.instructor.id)).toEqual([
      { kind: "discussion-question", read: true },
    ]);
  });

  it("asks the Notification Provider about the person's own Notifications only", async () => {
    const provider = createFakeNotificationProvider();
    const question = askDiscussionQuestion(
      liam.id,
      "When should I reach for a union instead of an enum?"
    );
    await notifyDiscussionQuestion(db, base.course.id, question.id, provider);
    const reply = postDiscussionReply(
      base.instructor.id,
      question.id,
      "Most of the time. Unions need no runtime code."
    );
    await notifyDiscussionReply(db, base.course.id, reply.id, provider);
    const [, discussionReply] = provider.sent;

    await markNotificationsRead(
      db,
      liam.id,
      { page: "lesson", lessonId: lesson.id },
      provider
    );

    expect(provider.markedRead).toEqual([
      { workflowRunId: discussionReply.workflowRunId, userId: liam.id },
    ]);
  });

  it("leaves Discussion Notifications on other lessons unread", async () => {
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

    await markNotificationsRead(
      db,
      liam.id,
      { page: "lesson", lessonId: addLesson("Generics").id },
      provider
    );

    expect(readStates(provider, liam.id)).toEqual([
      { kind: "discussion-reply", read: false },
    ]);
  });

  // Decided the way the Refund Request review page decides them.
  function approveAs(platformAdminId: number, refundRequestId: number) {
    const result = approveRefundRequest(
      db,
      refundRequestId,
      platformAdminId,
      null,
      new Date()
    );
    if (!result.ok) throw new Error(result.error);
  }

  it("marks Refund Request decided read when the buyer opens their Refund Requests", async () => {
    const provider = createFakeNotificationProvider();
    const alex = addPlatformAdmin("Alex Rivera");
    const refundRequest = raiseRefundRequest(
      buyCourse(liam.id, 7900).id,
      "The pace is too fast for me."
    );
    approveAs(alex.id, refundRequest.id);
    await notifyRefundRequestDecided(db, refundRequest.id, provider);

    await markNotificationsRead(
      db,
      liam.id,
      { page: "refund-requests" },
      provider
    );

    expect(readStates(provider, liam.id)).toEqual([
      { kind: "refund-request-decided", read: true },
    ]);
  });

  // One send tells every Platform Admin.
  it("marks Open Refund Request read for the Platform Admin who opens the review page, and nobody else", async () => {
    const provider = createFakeNotificationProvider();
    const alex = addPlatformAdmin("Alex Rivera");
    const pat = addPlatformAdmin("Pat Admin");
    const refundRequest = raiseRefundRequest(
      buyCourse(liam.id, 7900).id,
      "The pace is too fast for me."
    );
    await notifyOpenRefundRequest(db, refundRequest.id, provider);

    await markNotificationsRead(
      db,
      alex.id,
      { page: "refund-request-review" },
      provider
    );

    expect({
      alex: readStates(provider, alex.id),
      pat: readStates(provider, pat.id),
    }).toEqual({
      alex: [{ kind: "open-refund-request", read: true }],
      pat: [{ kind: "open-refund-request", read: false }],
    });
  });

  it("marks Seat claimed read when the Team Admin opens the team page", async () => {
    const provider = createFakeNotificationProvider();
    const ava = addStudent("Ava Nakamura");
    const { seats } = buyTeamLicence(ava.id, 3);
    claimSeat(seats[0].id, liam.id);
    await notifySeatClaimed(db, seats[0].id, provider);

    await markNotificationsRead(db, ava.id, { page: "team" }, provider);

    expect(readStates(provider, ava.id)).toEqual([
      { kind: "seat-claimed", read: true },
    ]);
  });

  it.each([
    { page: "refund-requests", kind: "refund-request-decided" },
    { page: "refund-request-review", kind: "open-refund-request" },
    { page: "team", kind: "seat-claimed" },
  ] as const)(
    "leaves Notifications that link elsewhere unread on opening $page",
    async ({ page, kind }) => {
      const provider = createFakeNotificationProvider();
      const alex = addPlatformAdmin("Alex Rivera");
      // A Platform Admin who also buys courses and runs a team.
      const pat = addPlatformAdmin("Pat Admin");
      const patsRefundRequest = raiseRefundRequest(
        buyCourse(pat.id, 7900).id,
        "I bought it twice by mistake."
      );
      approveAs(alex.id, patsRefundRequest.id);
      await notifyRefundRequestDecided(db, patsRefundRequest.id, provider);
      const liamsRefundRequest = raiseRefundRequest(
        buyCourse(liam.id, 7900).id,
        "The pace is too fast for me."
      );
      await notifyOpenRefundRequest(db, liamsRefundRequest.id, provider);
      const { seats } = buyTeamLicence(pat.id, 3);
      claimSeat(seats[0].id, liam.id);
      await notifySeatClaimed(db, seats[0].id, provider);

      await markNotificationsRead(db, pat.id, { page }, provider);

      expect(readStates(provider, pat.id)).toEqual([
        { kind: "seat-claimed", read: kind === "seat-claimed" },
        { kind: "open-refund-request", read: kind === "open-refund-request" },
        {
          kind: "refund-request-decided",
          read: kind === "refund-request-decided",
        },
      ]);
    }
  );

  it("logs a failed markRead and still returns normally, so the page opens", async () => {
    const failure = new Error("The Notification Provider is down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const [discussionReply] = provider.sent;

    await expect(
      markNotificationsRead(
        db,
        liam.id,
        { page: "lesson", lessonId: lesson.id },
        failingToMarkRead(provider, failure)
      )
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(discussionReply.workflowRunId),
      failure
    );
  });

  it("asks the Notification Provider once per Notification, however often its page opens", async () => {
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
    const [discussionReply] = provider.sent;
    const lessonPage = { page: "lesson", lessonId: lesson.id } as const;

    await markNotificationsRead(db, liam.id, lessonPage, provider);
    await markNotificationsRead(db, liam.id, lessonPage, provider);

    expect(provider.markedRead).toEqual([
      { workflowRunId: discussionReply.workflowRunId, userId: liam.id },
    ]);
  });

  it("tries again the next time the page opens when the Notification Provider failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    const lessonPage = { page: "lesson", lessonId: lesson.id } as const;
    await markNotificationsRead(
      db,
      liam.id,
      lessonPage,
      failingToMarkRead(
        provider,
        new Error("The Notification Provider is down")
      )
    );

    await markNotificationsRead(db, liam.id, lessonPage, provider);

    expect(readStates(provider, liam.id)).toEqual([
      { kind: "discussion-reply", read: true },
    ]);
  });
});
