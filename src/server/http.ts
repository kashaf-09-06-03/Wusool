import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod/v4";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const bad = (message: string, code = "BAD_REQUEST", details?: unknown) => new AppError(400, code, message, details);
export const forbidden = (message = "You don’t have permission to do that.") => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found.") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string, code = "CONFLICT", details?: unknown) => new AppError(409, code, message, details);

type Handler<C> = (req: Request, ctx: C) => Promise<unknown> | unknown;

/** Wrap a route handler: JSON in/out, typed errors, no stack traces to the client. */
export function route<C = { params: Promise<Record<string, string>> }>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
      if (e instanceof z.ZodError)
        return NextResponse.json({ error: { code: "VALIDATION", message: e.issues[0]?.message ?? "Invalid input", details: e.issues } }, { status: 400 });
      console.error("[wusool] unhandled", e);
      return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Nothing was changed." } }, { status: 500 });
    }
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw bad("Expected a JSON body.");
  }
  return schema.parse(json);
}
