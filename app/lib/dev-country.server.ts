import { commitSession, getSession } from "~/lib/session";

// The DevUI country override. The DevUI panel sets it to test PPP prices and
// the PPP country check. Country resolution reads it first.

export async function getDevCountry(request: Request): Promise<string | null> {
  const session = await getSession(request);
  const country = session.get("devCountry");
  return typeof country === "string" ? country : null;
}

export async function setDevCountry(request: Request, country: string | null) {
  const session = await getSession(request);
  if (country) {
    session.set("devCountry", country);
  } else {
    session.unset("devCountry");
  }
  return commitSession(session);
}
