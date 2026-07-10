// Exports générés côté navigateur (PDF / DOCX / XLSX) pour le dashboard
// Superviseur — jamais côté serveur (Cloudflare Worker), pour éviter tout
// souci de compatibilité avec ces bibliothèques.
//
// Chaque bibliothèque lourde (jspdf, docx, xlsx) est chargée via import()
// dynamique À L'INTÉRIEUR de la fonction d'export correspondante — jamais
// en haut de ce fichier. Vite/Rollup place donc chacune dans son propre
// chunk, chargé uniquement au moment du clic sur le bouton d'export
// concerné, sans alourdir le chargement initial du dashboard.

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(s: string, fallback: string): string {
  const cleaned = s.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60);
  return cleaned || fallback;
}

// En-tête de marque commun à tous les PDF générés ici — bandeau sombre,
// liseré or, "AURUM SYSTEM". Version simplifiée du header de pdf.ts,
// dupliquée volontairement pour ne pas importer pdf.ts (et donc jspdf)
// de façon statique dans ce module.
function drawAurumPdfHeader(pdf: any, subtitle: string): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(20, 20, 20);
  pdf.rect(0, 0, pageWidth, 60, "F");
  pdf.setFillColor(201, 168, 76);
  pdf.rect(0, 60, pageWidth, 3, "F");
  pdf.setFillColor(201, 168, 76);
  pdf.roundedRect(40, 14, 32, 32, 6, 6, "F");
  pdf.setTextColor(20, 20, 20);
  pdf.setFont("times", "bold");
  pdf.setFontSize(18);
  pdf.text("A", 51, 36);
  pdf.setTextColor(232, 196, 100);
  pdf.setFont("times", "bold");
  pdf.setFontSize(15);
  pdf.text("AURUM SYSTEM", 82, 30);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(200, 200, 200);
  pdf.text(subtitle, 82, 46);
  return 90;
}

function drawAurumPdfFooter(pdf: any) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(201, 168, 76);
    pdf.setLineWidth(0.5);
    pdf.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
    pdf.setFontSize(8);
    pdf.setTextColor(130, 130, 130);
    pdf.text("Généré par AURUM SYSTEM", margin, pageHeight - 22);
    pdf.text(`Page ${i} / ${pageCount}`, pageWidth - margin, pageHeight - 22, { align: "right" });
  }
}

// ============================================================
// XLSX — Activités récentes
// ============================================================

export type ActivityExportRow = {
  agent: string;
  title: string;
  location: string;
  date: string;
  status: string;
};

export async function exportActivitiesXlsx(rows: ActivityExportRow[]) {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => ({
    Agent: r.agent,
    Titre: r.title,
    Lieu: r.location,
    Date: r.date,
    Statut: r.status,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 22 }, { wch: 34 }, { wch: 22 }, { wch: 20 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Activités");
  XLSX.writeFile(wb, `aurum-activites-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ============================================================
// PDF — Fiche de traçabilité parcelle
// ============================================================

export type ParcelleTraceabilityData = {
  culture: string;
  surfaceHa: number | null;
  cooperativeName: string | null;
  producerName: string | null;
  lat: number | null;
  lng: number | null;
  boundaryPoints: Array<{ lat: number; lng: number }> | null;
  documents: Array<{
    title: string | null;
    missionType: string | null;
    agentName: string;
    createdAt: string;
    photoCount: number;
    videoCount: number;
    validatedAt: string | null;
  }>;
  // Section EUDR — omise du PDF si null (extension désactivée pour
  // l'organisation, ou parcelle sans attestation).
  eudrAttestation?: {
    deforestationFree: boolean;
    attestedByName: string;
    attestedAt: string;
    notes: string | null;
  } | null;
};

export async function exportParcelleTraceabilityPdf(data: ParcelleTraceabilityData) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = drawAurumPdfHeader(pdf, "Fiche de traçabilité — Parcelle");

  const ensureSpace = (h: number) => {
    if (y + h > pageHeight - 50) {
      pdf.addPage();
      y = margin;
    }
  };

  pdf.setFont("times", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(20, 20, 20);
  pdf.text(data.culture, margin, y);
  y += 26;

  pdf.setFont("times", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(120, 95, 30);
  pdf.text("INFORMATIONS DE LA PARCELLE", margin, y);
  y += 14;

  const locationLabel = data.boundaryPoints && data.boundaryPoints.length >= 3
    ? `Périmètre GPS (${data.boundaryPoints.length} points)`
    : data.lat != null && data.lng != null
      ? `${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`
      : "—";

  const infos: Array<[string, string]> = [
    ["Culture", data.culture || "—"],
    ["Surface", data.surfaceHa != null ? `${data.surfaceHa} ha` : "—"],
    ["Coopérative", data.cooperativeName ?? "—"],
    ["Producteur", data.producerName ?? "—"],
    ["Coordonnées", locationLabel],
  ];

  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.5);
  const rowH = 18;
  const boxTop = y;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  for (let i = 0; i < infos.length; i++) {
    const ry = boxTop + i * rowH;
    pdf.setTextColor(140, 140, 140);
    pdf.text(infos[i][0].toUpperCase(), margin + 8, ry + 7);
    pdf.setTextColor(20, 20, 20);
    const val = pdf.splitTextToSize(infos[i][1], contentWidth - 160);
    pdf.text(val, margin + 150, ry + 7);
  }
  const boxBottom = boxTop + infos.length * rowH + 4;
  pdf.rect(margin, boxTop - 8, contentWidth, boxBottom - boxTop + 4);
  y = boxBottom + 24;

  ensureSpace(30);
  pdf.setFont("times", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(120, 95, 30);
  const histHeading = `HISTORIQUE DES VISITES (${data.documents.length})`;
  pdf.text(histHeading, margin, y);
  pdf.setDrawColor(201, 168, 76);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y + 3, margin + pdf.getTextWidth(histHeading), y + 3);
  y += 20;

  // Ordre chronologique (le plus ancien en premier) pour lire l'histoire
  // de la parcelle dans le sens naturel.
  const chronological = [...data.documents].reverse();

  if (chronological.length === 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text("Aucune visite enregistrée pour l'instant.", margin, y);
    y += 16;
  }

  for (const doc of chronological) {
    ensureSpace(48);
    const dateStr = new Date(doc.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(20, 20, 20);
    pdf.text(`${dateStr} — ${doc.title || "Sans titre"}`, margin, y);
    y += 13;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    const meta = [
      `Agent : ${doc.agentName}`,
      doc.missionType ? `Mission : ${doc.missionType}` : null,
      `${doc.photoCount} photo${doc.photoCount !== 1 ? "s" : ""}`,
      `${doc.videoCount} vidéo${doc.videoCount !== 1 ? "s" : ""}`,
      doc.validatedAt ? "Validé" : "En attente de validation",
    ].filter(Boolean).join("  ·  ");
    const metaLines = pdf.splitTextToSize(meta, contentWidth);
    pdf.text(metaLines, margin, y);
    y += metaLines.length * 11 + 10;

    pdf.setDrawColor(235, 235, 235);
    pdf.setLineWidth(0.4);
    pdf.line(margin, y - 4, margin + contentWidth, y - 4);
  }

  if (data.eudrAttestation) {
    y += 16;
    ensureSpace(70);
    pdf.setFont("times", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(120, 95, 30);
    const eudrHeading = "ATTESTATION DE CONFORMITÉ EUDR";
    pdf.text(eudrHeading, margin, y);
    pdf.setDrawColor(201, 168, 76);
    pdf.setLineWidth(0.6);
    pdf.line(margin, y + 3, margin + pdf.getTextWidth(eudrHeading), y + 3);
    y += 18;

    const eudr = data.eudrAttestation;
    const eudrInfos: Array<[string, string]> = [
      ["Statut", eudr.deforestationFree ? "Absence de déforestation confirmée" : "Non conforme"],
      ["Date", new Date(eudr.attestedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })],
      ["Attestant", eudr.attestedByName],
      ["Notes", eudr.notes || "—"],
    ];
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    for (const [label, value] of eudrInfos) {
      ensureSpace(16);
      pdf.setTextColor(140, 140, 140);
      pdf.text(label.toUpperCase(), margin, y);
      pdf.setTextColor(20, 20, 20);
      const val = pdf.splitTextToSize(value, contentWidth - 100);
      pdf.text(val, margin + 100, y);
      y += Math.max(14, val.length * 12);
    }
  }

  drawAurumPdfFooter(pdf);
  pdf.save(`${safeFilename(`parcelle-${data.culture}`, "parcelle")}.pdf`);
}

// ============================================================
// PDF / DOCX — Rapport Agro Advisor
// ============================================================

export type AdvisorReportExportData = {
  createdAt: string;
  documentsAnalyzed: number;
  analysis: string;
};

export async function exportAdvisorReportPdf(report: AdvisorReportExportData) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = drawAurumPdfHeader(pdf, "Agro Advisor — Analyse IA");

  const ensureSpace = (h: number) => {
    if (y + h > pageHeight - 50) {
      pdf.addPage();
      y = margin;
    }
  };

  const dateStr = new Date(report.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Date : ${dateStr}`, margin, y);
  y += 14;
  pdf.text(`Documents analysés : ${report.documentsAnalyzed}`, margin, y);
  y += 24;

  pdf.setDrawColor(201, 168, 76);
  pdf.setLineWidth(1);
  pdf.line(margin, y, margin + 70, y);
  y += 22;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10.5);
  pdf.setTextColor(30, 30, 30);
  const lines = pdf.splitTextToSize(report.analysis || "—", contentWidth);
  for (const line of lines) {
    ensureSpace(15);
    pdf.text(line, margin, y);
    y += 14;
  }

  drawAurumPdfFooter(pdf);
  pdf.save(`${safeFilename(`agro-advisor-${report.createdAt.slice(0, 10)}`, "agro-advisor")}.pdf`);
}

export async function exportAdvisorReportDocx(report: AdvisorReportExportData) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const dateStr = new Date(report.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: "AURUM SYSTEM", bold: true, color: "C9A84C" })],
        }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "Agro Advisor — Analyse IA" })],
        }),
        new Paragraph({ text: `Date : ${dateStr}` }),
        new Paragraph({ text: `Documents analysés : ${report.documentsAnalyzed}` }),
        new Paragraph({ text: "" }),
        ...report.analysis.split("\n").map((line) => new Paragraph({ text: line })),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${safeFilename(`agro-advisor-${report.createdAt.slice(0, 10)}`, "agro-advisor")}.docx`);
}
