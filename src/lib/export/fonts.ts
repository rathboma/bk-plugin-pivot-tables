import regularUrl from "dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?inline";
import boldUrl from "dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?inline";
import type { PdfFont } from "./pdf";

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/**
 * DejaVu Sans covers Latin, Greek, Cyrillic and more, which the PDF
 * standard fonts can't draw. Loaded lazily since it's ~1.5MB.
 */
export function loadUnicodeFont(): PdfFont {
  return { name: "DejaVuSansCondensed", regular: base64Of(regularUrl), bold: base64Of(boldUrl) };
}
