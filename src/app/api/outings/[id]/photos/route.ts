import { bad, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { addPhotos, listPhotos } from "@/server/photos";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => ({ photos: listPhotos((await params).id, await requireUser()) }));

export const POST = route<P>(async (req, { params }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw bad("Expected photos.");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  return { results: await addPhotos((await params).id, await requireUser(), files) };
});
