import { getDevCountry } from "~/lib/dev-country.server";

// ─── Country Resolution ───
// Layered approach: (1) dev session override, (2) CF-IPCountry header.
// Returns a 2-letter ISO country code or null. Null prices at full price
// (Tier 1): a page never waits on a network call to learn the country.

export async function resolveCountry(request: Request): Promise<string | null> {
  // 1. Dev session override
  const devCountry = await getDevCountry(request);
  if (devCountry && devCountry.length === 2) {
    return devCountry.toUpperCase();
  }

  // 2. Cloudflare CF-IPCountry header
  const cfCountry = request.headers.get("CF-IPCountry");
  if (cfCountry && cfCountry.length === 2 && cfCountry !== "XX") {
    return cfCountry.toUpperCase();
  }

  return null;
}
