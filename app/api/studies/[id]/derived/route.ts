import { NextResponse } from "next/server";
import { isValidIdentifier } from "@/lib/ai-security";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: studyId } = await params;
    if (!studyId || !isValidIdentifier(studyId)) {
      return NextResponse.json({ error: "Invalid studyId" }, { status: 400 });
    }

    const derivedDir = path.join(process.cwd(), ".scanlab", "derived", studyId);
    if (!fs.existsSync(derivedDir)) {
      return NextResponse.json({
        studyId,
        available: false,
        assets: {},
      });
    }

    const metadataPath = path.join(derivedDir, "metadata.json");
    let metadata = null;
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      } catch (e) {}
    }

    const checkFile = (relPath: string) => fs.existsSync(path.join(derivedDir, relPath));

    return NextResponse.json({
      studyId,
      available: true,
      metadata,
      assets: {
        heart: {
          available: checkFile("heart/mesh.glb") || checkFile("meshes/heart.glb"),
          meshGlb: checkFile("heart/mesh.glb") ? `/api/studies/${studyId}/derived/heart/mesh.glb` : (checkFile("meshes/heart.glb") ? `/api/studies/${studyId}/derived/meshes/heart.glb` : null),
          meshVtp: checkFile("heart/mesh.vtp") ? `/api/studies/${studyId}/derived/heart/mesh.vtp` : null,
          segmentation: checkFile("heart/segmentation.nii.gz") ? `/api/studies/${studyId}/derived/heart/segmentation.nii.gz` : null,
          measurements: checkFile("heart/measurements.json") ? `/api/studies/${studyId}/derived/heart/measurements.json` : null,
        },
        lungs: {
          available: checkFile("lungs/mesh.glb") || checkFile("meshes/lung_right.glb"),
          meshGlb: checkFile("lungs/mesh.glb") ? `/api/studies/${studyId}/derived/lungs/mesh.glb` : null,
          meshVtp: checkFile("lungs/mesh.vtp") ? `/api/studies/${studyId}/derived/lungs/mesh.vtp` : null,
          segmentation: checkFile("lungs/segmentation.nii.gz") ? `/api/studies/${studyId}/derived/lungs/segmentation.nii.gz` : null,
          lobes: checkFile("lungs/lobes.nii.gz") ? `/api/studies/${studyId}/derived/lungs/lobes.nii.gz` : null,
          airways: checkFile("lungs/airways.nii.gz") ? `/api/studies/${studyId}/derived/lungs/airways.nii.gz` : null,
          vessels: checkFile("lungs/vessels.nii.gz") ? `/api/studies/${studyId}/derived/lungs/vessels.nii.gz` : null,
          measurements: checkFile("lungs/measurements.json") ? `/api/studies/${studyId}/derived/lungs/measurements.json` : null,
        },
        brain: {
          available: checkFile("brain/parcellation.nii.gz"),
          parcellation: checkFile("brain/parcellation.nii.gz") ? `/api/studies/${studyId}/derived/brain/parcellation.nii.gz` : null,
          metadata: checkFile("brain/metadata.json") ? `/api/studies/${studyId}/derived/brain/metadata.json` : null,
        },
        registration: {
          available: checkFile("registration/registered_prior.nii.gz"),
          registeredPrior: checkFile("registration/registered_prior.nii.gz") ? `/api/studies/${studyId}/derived/registration/registered_prior.nii.gz` : null,
          displacementField: checkFile("registration/displacement_field.nii.gz") ? `/api/studies/${studyId}/derived/registration/displacement_field.nii.gz` : null,
          differenceMap: checkFile("registration/difference_map.nii.gz") ? `/api/studies/${studyId}/derived/registration/difference_map.nii.gz` : null,
        },
        motion4d: {
          available: checkFile("motion4d/animation.glb"),
          animationGlb: checkFile("motion4d/animation.glb") ? `/api/studies/${studyId}/derived/motion4d/animation.glb` : null,
        },
        findings: {
          available: checkFile("findings/findings.json"),
          url: checkFile("findings/findings.json") ? `/api/studies/${studyId}/derived/findings/findings.json` : null,
        },
        report: {
          draftAvailable: checkFile("report/draft.json"),
          finalReportAvailable: checkFile("report/final_report.json"),
          pdfAvailable: checkFile("report/final.pdf"),
          pdfUrl: checkFile("report/final.pdf") ? `/api/studies/${studyId}/derived/report/final.pdf` : null,
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list derived assets" }, { status: 500 });
  }
}
