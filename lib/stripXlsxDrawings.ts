import JSZip from "jszip";

// Isomorphic (runs in the browser and in Node/server routes — no filesystem
// or Node-only APIs) so the same stripping happens on both sides: once
// client-side before upload (shrinks the file so it doesn't get rejected by
// Vercel's request-size limit — "Request Entity Too Large" — for files with
// large embedded images/logos) and again server-side as a safety net for
// anything already saved without going through the client path.
//
// exceljs 4.4.0 also crashes with "Cannot read properties of undefined
// (reading 'anchors')" on some real-world xlsx files that carry an embedded
// image/logo or a cell-comment drawing it can't fully parse. exceljs parses
// every xl/drawings/*.xml part unconditionally while loading (xlsx.js scans
// all zip entries by path, independent of whether any worksheet actually
// references that drawing) — so it's not enough to remove the <drawing>
// reference from the worksheet XML; the drawing part itself still gets
// parsed and still crashes. We only ever read cell values here, never
// images, so the reliable fix is to delete the drawing/media parts from the
// zip entirely before handing the buffer to exceljs.
export async function stripXlsxDrawings(data: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(data);
    const sheetPaths = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
    for (const path of sheetPaths) {
      const file = zip.file(path);
      if (!file) continue;
      const xml = await file.async("string");
      const stripped = xml.replace(/<drawing\b[^>]*\/>/g, "").replace(/<legacyDrawing\b[^>]*\/>/g, "");
      if (stripped !== xml) zip.file(path, stripped);

      const relsPath = `xl/worksheets/_rels/${path.split("/").pop()}.rels`;
      const relsFile = zip.file(relsPath);
      if (relsFile) {
        const relsXml = await relsFile.async("string");
        const strippedRels = relsXml.replace(/<Relationship\b[^>]*Type="[^"]*\/(?:drawing|vmlDrawing)"[^>]*\/>/g, "");
        if (strippedRels !== relsXml) zip.file(relsPath, strippedRels);
      }
    }

    // Remove the drawing/media parts themselves (drawing defs, their rels,
    // legacy VML drawings, and the embedded image binaries) — this is what
    // actually shrinks the file size, and also what keeps exceljs's own
    // unconditional zip-entry scan from ever parsing them.
    for (const path of Object.keys(zip.files)) {
      if (/^xl\/drawings\//.test(path) || /^xl\/media\//.test(path)) zip.remove(path);
    }

    // JSZip defaults to no compression (STORE) when none is specified, which
    // can leave the output LARGER than the original despite removing the
    // image data — DEFLATE is what actually shrinks the file for upload.
    return await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  } catch {
    return data;
  }
}
