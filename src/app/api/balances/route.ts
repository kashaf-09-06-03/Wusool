import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { myBalances } from "@/server/balances";

export const GET = route(async () => {
  const user = await requireUser();
  return { balances: myBalances(user), threshold: user.threshold };
});
