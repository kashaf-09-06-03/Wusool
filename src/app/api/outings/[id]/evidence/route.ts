import { bad, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { saveEvidence } from "@/server/expenses";

type P = { params: Promise<{ id: string }> };

/** Multipart upload: one or more `file` fields, plus `kind` and optional `payerMemberId`. */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) throw bad("Expected a file upload.");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw bad("Choose at least one image.");
  const kind = String(form.get("kind") ?? "receipt");
  const payer = form.get("payerMemberId") ? String(form.get("payerMemberId")) : null;
  const results = [];
  for (const f of files) {
    try {
      results.push({ name: f.name, ok: true, ...(await saveEvidence(id, user, f, kind, payer)) });
    } catch (e) {
      results.push({ name: f.name, ok: false, error: e instanceof Error ? e.message : "Upload failed" });
    }
  }
  return { results };
});
