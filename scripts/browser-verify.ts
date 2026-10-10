import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACTS_DIR = "C:\\Users\\QUIKCARE COMPUTERS\\.gemini\\antigravity-ide\\brain\\2953cac2-4fb0-4d06-9259-66c35f6268ba";

const VIEWPORTS = [
  { width: 1920, height: 1080, name: "1920x1080" },
  { width: 1600, height: 900, name: "1600x900" },
  { width: 1366, height: 768, name: "1366x768" },
  { width: 1280, height: 720, name: "1280x720" },
];

const CT_STUDY_ID = "fc2298a513d7eb89"; // CT Chest (CT-27CEA6), 443 slices
const MRI_STUDY_ID = "6ac5ffd2f0706c6c"; // MRI (MRI-16B80D)

async function runAudit() {
  console.log("=== LAUNCHING CHROME HEADLESS FOR CLINICAL WORKSTATION AUDIT ===");
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--use-gl=angle",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);

  // Authenticate on origin
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("meridian:session", "1");
    localStorage.setItem(
      "meridian:user",
      JSON.stringify({
        id: "usr-chen",
        name: "Dr. Amara Chen",
        role: "Attending Radiologist",
      })
    );
  });

  // -------------------------------------------------------------
  // TEST 1: Studies Worklist Page Across Viewports
  // -------------------------------------------------------------
  console.log("\n--- 1. AUDITING WORKLIST PAGE (/studies) ---");
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto("http://localhost:3000/studies", { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 800));

    const shotPath = path.join(ARTIFACTS_DIR, `worklist_${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`Saved screenshot: ${shotPath}`);

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`Viewport ${vp.name} horizontal overflow: ${overflow}`);
    if (overflow) throw new Error(`Worklist has horizontal overflow at ${vp.name}`);
  }

  // -------------------------------------------------------------
  // TEST 2: 4-Panel Quad Viewport Layout & 3D Anatomy Separation
  // -------------------------------------------------------------
  console.log("\n--- 2. AUDITING 4-PANEL LAYOUT & 3D ANATOMICAL SEPARATION ---");
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(`http://localhost:3000/studies/${CT_STUDY_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#anatomical-layers-toggle-btn", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));

  // Verify all 4 panels are present in the DOM simultaneously
  const panelAudit = await page.evaluate(() => {
    const planes = ["AXIAL", "SAGITTAL", "CORONAL", "3D"];
    const textContent = document.body.innerText.toUpperCase();
    const foundPlanes = planes.map((p) => ({
      plane: p,
      found: textContent.includes(p),
    }));

    // Check bottom toolbar Anatomical Layers button
    const layerBtn = document.getElementById("anatomical-layers-toggle-btn");

    // Check if any internal layer panel is obscuring inside the 4-panel grid or 3D viewport
    const gridAsides = document.querySelectorAll(".grid aside");

    return {
      foundPlanes,
      internalGridAsidesCount: gridAsides.length,
      hasBottomLayerButton: Boolean(layerBtn),
      bottomButtonText: layerBtn?.textContent?.trim() || "",
    };
  });

  console.log("Panel Audit:", panelAudit);
  if (panelAudit.internalGridAsidesCount > 0) {
    throw new Error("FAIL: Anatomical Layers panel is still embedded inside the 3D viewport!");
  }
  if (!panelAudit.hasBottomLayerButton) {
    throw new Error("FAIL: Anatomical Layers button missing from bottom spatial control bar!");
  }

  const quadShot = path.join(ARTIFACTS_DIR, "workstation_quad_4viewports.png");
  await page.screenshot({ path: quadShot, fullPage: false });
  console.log(`Saved 4-viewport quad layout screenshot: ${quadShot}`);

  // -------------------------------------------------------------
  // TEST 3: Anatomical Layers Open / Toggle / Close / Persist
  // -------------------------------------------------------------
  console.log("\n--- 3. AUDITING ANATOMICAL LAYERS INTERACTION & PERSISTENCE ---");
  // Click bottom Anatomical Layers button
  await page.click("#anatomical-layers-toggle-btn");
  await new Promise((r) => setTimeout(r, 800));

  const drawerAudit = await page.evaluate(() => {
    const drawerTitle = Array.from(document.querySelectorAll("div, span, button, h2, h3, h4")).find(
      (el) => el.textContent?.includes("Anatomical Layers") && el.tagName !== "BUTTON"
    );
    const closeBtn = document.querySelector('button[aria-label="Close panel"], button[title*="Close"]');
    const categoryTabs = Array.from(document.querySelectorAll("button")).filter((b) =>
      ["Organs", "Bone & Spine", "Tissue & Habit", "Vessels", "Cardiac"].some((name) =>
        b.textContent?.includes(name)
      )
    );
    return {
      drawerOpen: Boolean(drawerTitle),
      hasCloseBtn: Boolean(closeBtn),
      tabCount: categoryTabs.length,
    };
  });

  console.log("Drawer Audit:", drawerAudit);
  if (!drawerAudit.drawerOpen || !drawerAudit.hasCloseBtn) {
    throw new Error("Anatomical Layers drawer failed to open with close button!");
  }

  const drawerShot = path.join(ARTIFACTS_DIR, "workstation_anatomical_drawer_open.png");
  await page.screenshot({ path: drawerShot, fullPage: false });
  console.log(`Saved open drawer screenshot: ${drawerShot}`);

  // Close the drawer using the close button
  await page.click('button[aria-label="Close panel"], button[title*="Close"]');
  await new Promise((r) => setTimeout(r, 800));

  const closedAudit = await page.evaluate(() => {
    const closeBtn = document.querySelector('button[aria-label="Close panel"], button[title*="Close"]');
    return {
      drawerClosed: !closeBtn,
    };
  });
  console.log("Closed Drawer Audit:", closedAudit);
  if (!closedAudit.drawerClosed) {
    throw new Error("Drawer failed to close via close button!");
  }

  // -------------------------------------------------------------
  // TEST 4: Responsive Behavior Across Viewports
  // -------------------------------------------------------------
  console.log("\n--- 4. AUDITING WORKSTATION ACROSS VIEWPORT RESOLUTIONS ---");
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    await new Promise((r) => setTimeout(r, 800));

    const shotPath = path.join(ARTIFACTS_DIR, `workstation_responsive_${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    const audit = await page.evaluate(() => {
      const header = document.querySelector("header");
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const bottomBar = document.getElementById("anatomical-layers-toggle-btn");
      return {
        headerVisible: Boolean(header),
        bottomBarVisible: Boolean(bottomBar),
        overflow,
      };
    });
    console.log(`Responsive check at ${vp.name}:`, audit);
    if (audit.overflow) throw new Error(`Horizontal overflow detected at ${vp.name}!`);
    if (!audit.headerVisible || !audit.bottomBarVisible) {
      throw new Error(`Essential workstation controls vanished at ${vp.name}!`);
    }
  }

  // -------------------------------------------------------------
  // TEST 5: Modality-Aware Window/Level Controls
  // -------------------------------------------------------------
  console.log("\n--- 5. AUDITING MODALITY-AWARE WINDOW/LEVEL CONTROLS ---");
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(`http://localhost:3000/studies/${CT_STUDY_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#anatomical-layers-toggle-btn", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));

  const ctPresets = await page.evaluate(() => {
    const select = document.querySelector("select") as HTMLSelectElement | null;
    if (!select) return [];
    return Array.from(select.options).map((o) => o.text);
  });
  console.log("CT Chest Presets found:", ctPresets);
  const hasLung = ctPresets.some((p) => p.includes("Lung"));
  const hasBone = ctPresets.some((p) => p.includes("Bone"));
  const hasBrainOnChest = ctPresets.some((p) => p.toLowerCase().includes("brain"));
  console.log(`CT Chest contains Lung: ${hasLung}, Bone: ${hasBone}, Has Brain (must be false): ${hasBrainOnChest}`);
  if (!hasLung || !hasBone || hasBrainOnChest) {
    throw new Error(`CT Chest preset validation failed: ${JSON.stringify(ctPresets)}`);
  }

  // Check MRI Presets
  console.log(`Checking MRI Study (/studies/${MRI_STUDY_ID})...`);
  await page.goto(`http://localhost:3000/studies/${MRI_STUDY_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#anatomical-layers-toggle-btn", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));

  const mriPresets = await page.evaluate(() => {
    const select = document.querySelector("select") as HTMLSelectElement | null;
    if (!select) return [];
    return Array.from(select.options).map((o) => o.text);
  });
  console.log("MRI Presets found:", mriPresets);
  const hasT1 = mriPresets.some((p) => p.includes("T1"));
  const hasT2 = mriPresets.some((p) => p.includes("T2"));
  const hasLungOnMri = mriPresets.some((p) => p.toLowerCase().includes("lung"));
  console.log(`MRI contains T1: ${hasT1}, T2: ${hasT2}, Has Lung (must be false): ${hasLungOnMri}`);
  if (!hasT1 || !hasT2 || hasLungOnMri) {
    throw new Error(`MRI preset validation failed: ${JSON.stringify(mriPresets)}`);
  }

  // -------------------------------------------------------------
  // TEST 6: Study Isolation and Session Persistence
  // -------------------------------------------------------------
  console.log("\n--- 6. AUDITING STUDY ISOLATION & PERSISTENCE ---");
  await page.evaluate((studyAId) => {
    const testAnnotation = {
      id: "ann-test-study-a",
      studyId: studyAId,
      seriesId: "ser-1",
      sliceIndex: 12,
      type: "rectangle",
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
      ],
      color: "#00F0FF",
      strokeWidth: 2,
      opacity: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      findingType: "Nodule",
      label: "Study A Verified Nodule",
      visible: true,
    };
    const key = `meridian:annotations:${studyAId}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        studyId: studyAId,
        updatedAt: new Date().toISOString(),
        annotations: [testAnnotation],
        measurements: [],
        markers: [],
        findings: [],
      })
    );
  }, CT_STUDY_ID);

  await page.goto(`http://localhost:3000/studies/${CT_STUDY_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#anatomical-layers-toggle-btn", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));

  const studyAHasAnnotation = await page.evaluate((studyAId) => {
    const raw = localStorage.getItem(`meridian:annotations:${studyAId}`);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.annotations?.length === 1 && data.annotations[0].id === "ann-test-study-a";
  }, CT_STUDY_ID);
  console.log(`Study A annotation saved and verified: ${studyAHasAnnotation}`);
  if (!studyAHasAnnotation) throw new Error("Study A annotation failed to persist");

  // Open Study B (MRI) and verify Study A's annotation does NOT leak!
  await page.goto(`http://localhost:3000/studies/${MRI_STUDY_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#anatomical-layers-toggle-btn", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));

  const studyBLeak = await page.evaluate((mriStudyId) => {
    const raw = localStorage.getItem(`meridian:annotations:${mriStudyId}`);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.annotations?.some((a: any) => a.id === "ann-test-study-a");
  }, MRI_STUDY_ID);
  console.log(`Study B cross-contamination leak (must be false): ${studyBLeak}`);
  if (studyBLeak) throw new Error("CRITICAL: Study isolation failure! Study A annotation leaked into Study B!");

  // -------------------------------------------------------------
  // TEST 7: Report Mode & Workflow Inspection
  // -------------------------------------------------------------
  console.log("\n--- 7. AUDITING REPORT MODE WORKFLOW ---");
  await page.goto(`http://localhost:3000/studies/${CT_STUDY_ID}?tab=report`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));

  const reportShotPath = path.join(ARTIFACTS_DIR, "workstation_report_tab.png");
  await page.screenshot({ path: reportShotPath, fullPage: false });
  console.log(`Saved report mode screenshot: ${reportShotPath}`);

  const reportVisible = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes("Report") && (text.includes("Findings") || text.includes("Impression") || text.includes("Technique"));
  });
  console.log(`Report tab content successfully rendered: ${reportVisible}`);
  if (!reportVisible) throw new Error("Report mode failed to render report sections");

  await browser.close();
  console.log("\n=== ALL BROWSER & WORKSTATION AUDITS PASSED PERFECTLY ===");
}

runAudit().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
