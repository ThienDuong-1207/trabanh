import path from "path";
import pdfmake from "pdfmake";

// pdfmake's PdfPrinter needs font descriptors pointing at real TTF data —
// unlike its browser build, it doesn't bundle Roboto server-side. These are
// the same 4 Roboto files (full Vietnamese glyph coverage) added under
// public/fonts for that reason. Shared module so every PDF builder registers
// fonts/access policy exactly once, on the one pdfmake singleton instance.
const FONT_DIR = path.join(process.cwd(), "public", "fonts");

pdfmake.addFonts({
  Roboto: {
    normal: path.join(FONT_DIR, "Roboto-Regular.ttf"),
    bold: path.join(FONT_DIR, "Roboto-Medium.ttf"),
    italics: path.join(FONT_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONT_DIR, "Roboto-MediumItalic.ttf"),
  },
});
// docDefinition content never references remote resources, so deny those —
// but local access must stay allowed since the Roboto font files above are
// themselves loaded through this same policy check.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => true);

export default pdfmake;
