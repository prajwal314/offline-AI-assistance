const fs = require("fs");
const { PDFParse } = require("pdf-parse");

async function extractText(filePath) {
  const data = fs.readFileSync(filePath);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const pages = Array.isArray(result.pages)
      ? result.pages
          .map((p, idx) => ({
            pageNumber: Number.isInteger(p && p.num) ? p.num : idx + 1,
            text: (p && p.text) ? String(p.text) : "",
          }))
          .filter((p) => p.text.trim().length > 0)
      : [];
    return { text: result.text || "", numPages: result.total || pages.length || null, pages };
  } finally {
    await parser.destroy();
  }
}

module.exports = { extractText };
