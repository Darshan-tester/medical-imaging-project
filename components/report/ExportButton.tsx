"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Study } from "@/lib/types";
import { exportStudyReportPDF } from "@/lib/pdf";
import { useUIStore } from "@/lib/store";

export function ExportButton({ study, className }: { study: Study; className?: string }) {
  const [exporting, setExporting] = useState(false);
  const pushToast = useUIStore((s) => s.pushToast);

  const handleExport = async () => {
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 350));
      exportStudyReportPDF(study);
      pushToast({ title: "Report exported", description: `${study.studyId}-report.pdf downloaded`, tone: "success" });
    } catch {
      pushToast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", tone: "critical" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant="outline" size="md" onClick={handleExport} disabled={exporting} className={className}>
      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Export PDF
    </Button>
  );
}
