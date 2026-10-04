import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

/* `params` is a Promise from Next.js 15 onward — see the note in ../route.ts. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Check derived finalized or draft report
  const derivedDir = path.join(process.cwd(), ".scanlab", "derived", id, "report");
  const finalFile = path.join(derivedDir, "final.json");
  const draftFile = path.join(derivedDir, "draft.json");
  for (const f of [finalFile, draftFile]) {
    if (fs.existsSync(f)) {
      try {
        const rep = JSON.parse(fs.readFileSync(f, "utf-8"));
        const reportText = rep.sections
          ? `CLINICAL INFORMATION:\n${rep.sections.clinicalInformation}\n\nTECHNIQUE:\n${rep.sections.technique}\n\nFINDINGS:\n${rep.sections.findings}\n\nIMPRESSION:\n${rep.sections.impression}`
          : JSON.stringify(rep);
        return NextResponse.json({ available: true, report: reportText, draft: rep });
      } catch (e) {}
    }
  }

  const manifest = readManifest();
  const ds = manifest?.studies.find((s) => s.id === id);
  if (!ds) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }
  if (!ds.report) {
    return NextResponse.json({ available: false });
  }
  return NextResponse.json({ available: true, report: ds.report });
}
