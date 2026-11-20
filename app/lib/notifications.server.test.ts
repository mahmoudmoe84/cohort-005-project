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
  type NotificationProvider,
} from "./notification-provider.server";
import {
  notifyDiscussionQuestion,
  notifyDiscussionReply,
  notifyOpenRefundRequest,
  notifySeatClaimed,
} from "./notifications.server";

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

function failingProvider(failure: Error): NotificationProvider {
  return {
    async send() {
      throw failure;
    },
    async feedCredentials(userId) {
      return { provider: "fake", userId };
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
