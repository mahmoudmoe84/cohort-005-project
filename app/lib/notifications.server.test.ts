import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { chooseNotifications } from "./notifications.server";

// Which adapter the app runs on, given its environment. Knock's
// feedCredentials signs a token locally, so telling the adapters apart never
// reaches Knock: Knock returns credentials, the logging adapter returns null.

const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const fullKnockEnv = {
  KNOCK_SECRET_API_KEY: "sk_test",
  KNOCK_PUBLIC_API_KEY: "pk_test",
  KNOCK_SIGNING_KEY: signingKey,
  KNOCK_FEED_CHANNEL_ID: "feed-channel",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chooseNotifications", () => {
  it("logs Notifications when there is no Knock secret key", async () => {
    const notifications = await chooseNotifications({});

    expect(await notifications.feedCredentials(1)).toBeNull();
  });

  it("uses Knock when every Knock variable is set", async () => {
    const notifications = await chooseNotifications(fullKnockEnv);

    expect(await notifications.feedCredentials(1)).toMatchObject({
      userId: "1",
      publicKey: "pk_test",
      feedChannelId: "feed-channel",
    });
  });

  it.each([
    "KNOCK_PUBLIC_API_KEY",
    "KNOCK_SIGNING_KEY",
    "KNOCK_FEED_CHANNEL_ID",
  ])(
    "falls back to logging, and says why, when %s is missing",
    async (missing) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const notifications = await chooseNotifications({
        ...fullKnockEnv,
        [missing]: undefined,
      });

      expect(await notifications.feedCredentials(1)).toBeNull();
      expect(error).toHaveBeenCalledWith(
        "[notifications] Knock is misconfigured; logging Notifications instead:",
        `${missing} must be set when KNOCK_SECRET_API_KEY is set`
      );
    }
  );
});
