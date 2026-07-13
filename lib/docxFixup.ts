import JSZip from "jszip";

// docx (the npm library) hardcodes every ImageRun's <wp:docPr id="1"/> instead
// of incrementing it, so any file with more than one image ends up with
// duplicate docPr ids. Real Word tolerates that, but stricter renderers
// (Google Docs preview, some PDF converters, etc.) can silently drop or
// hide a drawing when they see an id they've already seen — the images
// disappeared from every embedded product's tag except one when we hit this
// on a multi-image roll-label export. Rewrite every docPr id to be unique
// after the fact rather than patching the library itself.
export async function fixDuplicateDocPrIds(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return buf;

  const xml = await docFile.async("string");
  let nextId = 1;
  const fixed = xml.replace(/(<wp:docPr\s+id=")\d+(")/g, (_match, before, after) => `${before}${nextId++}${after}`);
  zip.file("word/document.xml", fixed);

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
