const fs = require("fs");
const { PDFParse } = require("pdf-parse");

async function extractText(filePath) {
  const data = fs.readFileSync(filePath);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return { text: result.text || "", numPages: result.total || null };
  } finally {
    await parser.destroy();
  }
}

module.exports = { extractText };
