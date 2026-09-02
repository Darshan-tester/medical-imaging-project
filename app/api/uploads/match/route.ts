import crypto from "crypto";

import { NextResponse } from "next/server";

import { getDataMode } from "@/lib/dataset/config";
import { getMirror, mirrorKeys, readMirroredJson } from "@/lib/dataset/mirror";
import { matchUpload, studyCodeFromFileName, type UploadMatchOutcome } from "@/lib/dataset/upload-match";

export const dynamic = "force-dynamic";

/**
 * Per-file and per-request byte caps.
 *
 * The handler holds each file in memory to hash it, so an uncapped request is a
 * trivial way to exhaust the dev server's heap. A chest JPEG is ~100 KB and a
 * single CT instance ~500 KB, so 32 MB per file is generous for anything the
 * export pack produces while still bounding one request to 128 MB.
 */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 24;

export interface UploadMatchResult {
  fileName: string;
  bytes: number;
  sha256: string;
  outcome: UploadMatchOutcome;
}

/**
 * Hashes uploaded files and reports which indexed study each one came from.
 *
 * Read-only by construction: nothing is written to disk, no path from the
 * request is ever joined onto a filesystem path, and the response carries only
 * ids, codes and labels — never `absPath`. There is no authentication here
 * because the app has none anywhere; that is acceptable for a local demo run
 * against a local dataset, but this endpoint should not be exposed on a network
 * without adding auth, since it lets a caller confirm whether a given file is
 * present in the indexed dataset.
 */
export async function POST(req: Request) {
  if (getDataMode() !== "dataset") {
    return NextResponse.json(
      { error: "Upload matching needs the dataset index — set NEXT_PUBLIC_DATA_MODE=dataset and run `npm run dataset:index`" },
      { status: 422 }
    );
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Upload too large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart/form-data body" }, { status: 400 });
  }

  const files = form.getAll("files").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were sent" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `At most ${MAX_FILES} files per request` }, { status: 413 });
  }

  const results: UploadMatchResult[] = [];
  let total = 0;
  // Resolved once per request rather than per file: on Workers this decides
  // which of the two lookup paths every file below takes.
  const mirrored = Boolean(getMirror());
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${file.name}" is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB limit` }, { status: 413 });
    }
    total += file.size;
    if (total > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Upload too large" }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const outcome = mirrored ? await mirroredMatch(sha256, file.name) : matchUpload(sha256, file.name);
    results.push({ fileName: file.name, bytes: bytes.byteLength, sha256, outcome });
  }

  return NextResponse.json({ results });
}

/**
 * The mirrored twin of `matchUpload`, for the deployed Worker.
 *
 * `matchUpload` needs two files that do not exist on Workers: the export pack
 * index, and the 5.5 MB manifest it resolves a study code against. So
 * `npm run mirror:export` precomputes the outcome of every lookup that can
 * succeed — by calling the real `matchUpload` — and this reads the answer back.
 *
 * The two lookups stay in the same order and keep the same precedence as the
 * local implementation: content hash first, filename second, never both. The
 * filename regex is `studyCodeFromFileName` itself rather than a copy of it, and
 * it touches no files, so there is no second set of rules that could drift.
 *
 * The final `unmatched` reason is word-for-word the one `matchUpload` returns for
 * the same situation. It is not a fallback to guessing — there is deliberately no
 * fuzzy match anywhere in this path, because a wrong match would attach one
 * patient's report to another patient's image.
 */
async function mirroredMatch(sha256: string, fileName: string): Promise<UploadMatchOutcome> {
  const byHash = await readMirroredJson<UploadMatchOutcome>(mirrorKeys.uploadMatchByHash(sha256)).catch(() => undefined);
  if (byHash) return byHash;

  const code = studyCodeFromFileName(fileName);
  if (code) {
    const byCode = await readMirroredJson<UploadMatchOutcome>(mirrorKeys.uploadMatchByCode(code)).catch(() => undefined);
    if (byCode) return byCode;
    return {
      status: "stale",
      reason: `Study ${code} is not in the deployed index — re-run \`npm run dataset:index\`, then \`npm run mirror:export\` and \`npm run mirror:upload\``,
    };
  }

  return {
    status: "unmatched",
    reason: "This file is not from the indexed dataset, so there is no real study or report to show for it",
  };
}
