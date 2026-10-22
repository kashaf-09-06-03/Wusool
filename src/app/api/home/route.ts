import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { homeView } from "@/server/views";

export const GET = route(async () => homeView(await requireUser()));
