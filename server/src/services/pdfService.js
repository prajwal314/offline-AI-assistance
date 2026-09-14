const fs = require("fs");
const pdfParse = require("pdf-parse");

async function extractText(filePath) {
  const data = fs.readFileSync(filePath);
  const result = await pdfParse(data);
  return {
    text: result.text || "",
    numPages: result.numpages || null,
  };
}

module.exports = { extractText };
