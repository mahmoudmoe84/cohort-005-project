import { createCookieSessionStorage, type Session } from "react-router";

// The session file. It holds the cookie session storage and the writes that
// the DevUI, login, signup and logout make. It does not read the signed-in
// user: only the Course Access module does that. The dependency-cruiser rule
// `routes-no-session` keeps the other routes out of this file.

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "cadence_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secrets: ["cadence-dev-secret"],
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function commitSession(session: Session) {
  return sessionStorage.commitSession(session);
}

export async function setCurrentUserId(request: Request, userId: number) {
  const session = await getSession(request);
  session.set("userId", userId);
  return commitSession(session);
}

export async function destroySession(request: Request) {
  const session = await getSession(request);
  return sessionStorage.destroySession(session);
}
