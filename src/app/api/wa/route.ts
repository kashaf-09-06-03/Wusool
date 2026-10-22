import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { whatsappSimView } from "@/server/views";
import { WHATSAPP_INTEGRATION_CONFIGURED } from "@/server/notify";

export const GET = route(async () => ({ configured: WHATSAPP_INTEGRATION_CONFIGURED, messages: whatsappSimView(await requireUser()) }));
