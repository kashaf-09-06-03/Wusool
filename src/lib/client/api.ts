"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(res.status, err.code ?? "HTTP_" + res.status, err.message ?? "Something went wrong.", err.details);
  }
  return json;
}

export const fetcher = (url: string) => fetch(url, { credentials: "same-origin" }).then(parse);

export async function api<T = unknown>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parse(res);
}

export async function upload<T = unknown>(url: string, form: FormData): Promise<T> {
  return parse(await fetch(url, { method: "POST", body: form, credentials: "same-origin" }));
}

export const idemKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
