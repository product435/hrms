import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { AiAnalysis, DeliveryMetrics } from "@/services/deliveryInsightsService";

export interface InsightsPdfInput {
  employeeName: string;
  metrics: DeliveryMetrics;
  analysis: AiAnalysis | null;
  /** Chart containers. Their first <svg> is rasterised; a failure falls back to the numeric table. */
  chartElements: (HTMLElement | null)[];
}

/** Standard PDF fonts only encode WinAnsi. Replace anything else rather than throw. */
function safe(text: string): string {
  return text.replace(/[\r\t]/g, " ").replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");
}

const pct = (value: number | null) => (value == null ? "n/a" : `${Math.round(value * 100)}%`);

/** SVG -> PNG bytes through an offscreen canvas. Returns null if the browser blocks it. */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Uint8Array | null> {
  try {
    const box = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const markup = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("SVG did not load"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob(resolve, "image/png");
        } catch {
          resolve(null); // tainted canvas
        }
      });
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildInsightsPdf(input: InsightsPdfInput): Promise<Uint8Array> {
  const { metrics, analysis } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const pageWidth = 595;
  const pageHeight = 842;
  const contentWidth = pageWidth - margin * 2;

  let page: PDFPage = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensure = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };
  const text = (
    value: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const face = opts.bold ? bold : font;
    const indent = opts.indent ?? 0;
    for (const line of wrap(value, face, size, contentWidth - indent)) {
      ensure(size + 4);
      y -= size + 3;
      page.drawText(line, {
        x: margin + indent,
        y,
        size,
        font: face,
        color: rgb(...(opts.color ?? [0.1, 0.1, 0.12])),
      });
    }
  };
  const heading = (value: string) => {
    y -= 8;
    text(value, { size: 12, bold: true, color: [0.1, 0.25, 0.45] });
    y -= 2;
  };
  const row = (label: string, value: string) => {
    ensure(14);
    y -= 13;
    page.drawText(safe(label), { x: margin, y, size: 10, font, color: rgb(0.35, 0.35, 0.4) });
    page.drawText(safe(value), {
      x: margin + 260,
      y,
      size: 10,
      font: bold,
      color: rgb(0.1, 0.1, 0.12),
    });
  };

  text("Delivery & work-report insights", { size: 18, bold: true });
  text(`${input.employeeName || "Employee"}  |  ${metrics.periodStart} to ${metrics.periodEnd}`, {
    size: 10,
    color: [0.4, 0.4, 0.45],
  });

  heading("Task delivery (computed from task records)");
  const t = metrics.tasks;
  row("Tasks due in period", String(t.dueInPeriod));
  row("Completed", `${t.completed} (${pct(t.completionRate)})`);
  row(
    "Completed on or before due date",
    `${t.completedOnTime} (on-time rate ${pct(t.onTimeRate)})`,
  );
  row(
    "Completed late",
    `${t.completedLate}${t.medianDaysLate != null ? ` (median ${t.medianDaysLate} days late)` : ""}`,
  );
  row("Open and past due", String(t.openPastDue));
  row("Open, not yet due", String(t.openNotYetDue));

  heading("Daily work report compliance");
  const d = metrics.dwr;
  row(
    "Expected report days",
    `${d.expectedDays} (${d.excusedDays} excused: leave, holiday, week-off)`,
  );
  row("Submitted on time", String(d.submittedOnTime));
  row("Submitted late", String(d.submittedLate));
  row("Missed", String(d.missed));
  row("Submission rate", pct(d.submissionRate));

  if (metrics.byProject.length > 0) {
    heading("By project");
    for (const p of metrics.byProject) {
      row(
        p.projectName,
        `${p.assigned} due | ${p.onTime} on time | ${p.late} late | ${p.openOverdue} overdue`,
      );
    }
  }

  if (analysis) {
    heading("AI analysis");
    if (analysis.status === "insufficient_data" || !analysis.scores) {
      text(analysis.summary || "Not enough submitted reports in this period for a fair analysis.");
    } else {
      row("Delivery", `${analysis.scores.delivery}/100`);
      row("Consistency", `${analysis.scores.consistency}/100`);
      row("Communication", `${analysis.scores.communication}/100`);
      row("Blocker resolution", `${analysis.scores.blockerResolution}/100`);
      y -= 4;
      text(analysis.summary);
      if (analysis.strengths.length) {
        y -= 4;
        text("Strengths", { bold: true });
        analysis.strengths.forEach((s) => text(`- ${s}`, { indent: 8 }));
      }
      if (analysis.risks.length) {
        y -= 4;
        text("Risks", { bold: true });
        analysis.risks.forEach((s) => text(`- ${s}`, { indent: 8 }));
      }
      text(
        `Model: ${analysis.model ?? "n/a"}. Narrative and scores are AI-generated; counts above are computed by the system.`,
        {
          size: 8,
          color: [0.5, 0.5, 0.55],
        },
      );
    }
  }

  // Charts are best-effort: the numeric tables above already carry every figure.
  const images: PDFImage[] = [];
  for (const element of input.chartElements) {
    const svg = element?.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    if (!svg) continue;
    const png = await svgToPng(svg);
    if (!png) continue;
    try {
      images.push(await doc.embedPng(png));
    } catch {
      /* skip this chart */
    }
  }
  if (images.length > 0) {
    heading("Charts");
    for (const image of images) {
      const scale = Math.min(1, contentWidth / image.width, 220 / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ensure(h + 8);
      y -= h;
      page.drawImage(image, { x: margin, y, width: w, height: h });
      y -= 8;
    }
  }

  return doc.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
