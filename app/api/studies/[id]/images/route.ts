import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { isValidIdentifier } from "@/lib/ai-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const manifest = readManifest();
    const study = manifest?.studies.find((s) => s.id === studyId);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const seriesList = (study.series || []).map((s) => ({
      seriesId: s.id,
      label: s.label,
      orientation: s.orientation,
      sliceCount: s.sliceCount,
      volumeAvailable: (s as any).volumeAvailable ?? (s.sliceCount > 10),
      images: (s.images || []).map((img, idx) => ({
        index: idx,
        url: `/api/studies/${studyId}/images/${s.id}/${idx}.png`,
        width: img.width,
        height: img.height,
      })),
    }));

    return NextResponse.json({
      studyId,
      modality: study.modality,
      series: seriesList,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list study images" }, { status: 500 });
  }
}
