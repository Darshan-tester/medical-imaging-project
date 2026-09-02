import { NextResponse } from "next/server";
import { readManifest } from "@/lib/dataset/manifest-store";
import { countByDataset } from "@/lib/dataset/counts";
import { mirrorKeys, serveMirroredJson } from "@/lib/dataset/mirror";
import { DATASET_SOURCE_LABEL, DatasetSourceId } from "@/lib/dataset/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const mirrored = await serveMirroredJson(mirrorKeys.datasets(), req);
  if (mirrored) return mirrored;

  const manifest = readManifest();
  const perDataset = countByDataset(manifest?.studies ?? []);
  const ids = Object.keys(perDataset) as DatasetSourceId[];
  const summary = ids.map((id) => ({
    dataset: id,
    label: DATASET_SOURCE_LABEL[id],
    ...perDataset[id],
  }));
  return NextResponse.json(summary);
}
