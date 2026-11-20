import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Transactional email ───
// Postmark delivers every email when POSTMARK_SERVER_TOKEN is set. Without a
// token (local dev, tests) each message is written to .outbox/ as a JSON file
// instead, so it can be read without sending anything.

export type Email = {
  /** Who it's from, when it isn't Cadence's usual address, FROM_ADDRESS. */
  from?: string;
  to: string;
  subject: string;
  body: string;
};

export interface MailTransport {
  send(email: Email): Promise<void>;
}

const FROM_ADDRESS = "Cadence <hello@cadence.dev>";

export function postmarkTransport(serverToken: string): MailTransport {
  return {
    async send(email) {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": serverToken,
        },
        body: JSON.stringify({
          From: email.from ?? FROM_ADDRESS,
          To: email.to,
          Subject: email.subject,
          TextBody: email.body,
          MessageStream: "outbound",
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Postmark rejected the email to ${email.to}: ${response.status}`
        );
      }
    },
  };
}

export function outboxTransport(directory: string): MailTransport {
  return {
    async send(email) {
      mkdirSync(directory, { recursive: true });
      const file = join(directory, `${Date.now()}-${email.to}.json`);
      writeFileSync(
        file,
        JSON.stringify(
          {
            from: email.from ?? FROM_ADDRESS,
            to: email.to,
            subject: email.subject,
            body: email.body,
          },
          null,
          2
        )
      );
    },
  };
}

function defaultTransport(): MailTransport {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  return token ? postmarkTransport(token) : outboxTransport(".outbox");
}

export async function sendEmail(
  email: Email,
  transport: MailTransport = defaultTransport()
): Promise<void> {
  await transport.send(email);
}
