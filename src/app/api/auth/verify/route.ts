import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { verifyOtp } from "@/server/auth";

export const POST = route(async (req) => {
  const input = await body(req, z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."), name: z.string().trim().max(40).default("") }));
  const user = await verifyOtp(input.phone, input.code, input.name);
  return { user: { id: user.id, name: user.name, onboarded: Boolean(user.onboarded) } };
});
