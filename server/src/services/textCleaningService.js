function cleanText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let t = raw.replace(/\r\n/g, "\n");
  t = t.replace(/<[^>]*>/g, " ");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.split("\n").map((l) => l.trim()).filter((l) => {
    if (!l) return false;
    if (/^(cookie|subscribe|advertisement|menu|navigation|footer|header)/i.test(l) && l.length < 80) return false;
    return true;
  }).join("\n");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/\n /g, "\n").trim();
  return t;
}

module.exports = { cleanText };
