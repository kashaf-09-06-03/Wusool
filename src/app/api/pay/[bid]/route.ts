import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { payInfo } from "@/server/payments";

type P = { params: Promise<{ bid: string }> };

/** Pay page data for one balance (payee details only for the two people on it). */
export const GET = route<P>(async (_req, { params }) => payInfo((await params).bid, await requireUser()));
