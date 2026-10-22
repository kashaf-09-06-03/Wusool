import { route } from "@/server/http";
import { logout } from "@/server/auth";

export const POST = route(async () => {
  await logout();
});
