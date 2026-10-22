import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { startOtp } from "@/server/auth";

export const POST = route(async (req) => {
  const { phone } = await body(req, z.object({ phone: z.string().min(6, "Enter your mobile number.") }));
  return startOtp(phone);
});
