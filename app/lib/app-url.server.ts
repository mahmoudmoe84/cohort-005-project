// ─── Cadence's own address ───
// A link that leaves Cadence, such as one in an email, has to be absolute.
// Every absolute link is built here, from APP_URL: Cadence's public origin,
// for example https://cadence.dev. It's never taken from the request, because
// a request's Host header says whatever the sender wants, so a link built from
// it could point anywhere.
//
// Without APP_URL (local dev, tests), links point at the local dev server.
// Set it wherever real email goes out.

const LOCAL_DEV_SERVER = "http://localhost:5173";

/** Turns a path inside Cadence, such as /settings, into an absolute URL. */
export function absoluteUrl(path: string): string {
  return new URL(path, process.env.APP_URL ?? LOCAL_DEV_SERVER).href;
}
