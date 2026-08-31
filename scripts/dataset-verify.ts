/** Run with: npm run dataset:verify (after npm run dataset:index) */
async function main() {
  const { runVerify } = await import("../lib/dataset/verify");
  const report = runVerify();

  const rows = Object.entries(report.perDataset);
  const nameWidth = Math.max(...rows.map(([k]) => k.length), 10);
  console.log(`${"DATASET".padEnd(nameWidth)}  STUDIES  IMAGES  REPORTS  COMPLETE PAIRS`);
  for (const [dataset, counts] of rows) {
    console.log(
      `${dataset.padEnd(nameWidth)}  ${String(counts.studies).padStart(7)}  ${String(counts.images).padStart(6)}  ${String(counts.reports).padStart(7)}  ${String(counts.completePairs).padStart(14)}`
    );
  }
  console.log(`${"-".repeat(nameWidth + 40)}`);
  console.log(
    `${"TOTAL".padEnd(nameWidth)}  ${String(report.totals.studies).padStart(7)}  ${String(report.totals.images).padStart(6)}  ${String(report.totals.reports).padStart(7)}  ${String(
      report.totals.completePairs
    ).padStart(14)}`
  );

  const p = report.problems;
  const problemSections: [string, string[]][] = [
    ["Missing images (file no longer on disk)", p.missingImages],
    ["Missing reports (no report matched)", p.missingReports],
    ["Broken image/report relationships", p.brokenRelationships],
    ["Invalid/corrupt files", p.invalidFiles],
    ["Duplicate study IDs", p.duplicateStudyIds],
    ["Unsupported formats", p.unsupportedFormats],
    ["Missing series", p.missingSeries],
    ["Unreadable files", p.unreadableFiles],
  ];

  let anyProblems = false;
  for (const [label, items] of problemSections) {
    if (items.length === 0) continue;
    anyProblems = true;
    console.log(`\n${label} (${items.length}):`);
    for (const item of items.slice(0, 15)) console.log(`  - ${item}`);
    if (items.length > 15) console.log(`  ...and ${items.length - 15} more.`);
  }

  if (!anyProblems) {
    console.log("\nNo integrity problems found.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nDataset verification failed:\n", err);
  process.exit(1);
});
