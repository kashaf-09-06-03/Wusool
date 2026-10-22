import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { deviceAccounts, switchAccount } from "@/server/auth";

/** Accounts signed in on this browser, for testing invites and Wusool/Maaf with several people. */
export const GET = route(async () => ({ accounts: await deviceAccounts() }));

export const POST = route(async (req) => {
  const { userId } = await body(req, z.object({ userId: z.string() }));
  await switchAccount(userId);
  return { accounts: await deviceAccounts() };
});
