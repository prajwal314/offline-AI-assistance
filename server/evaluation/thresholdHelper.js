const { searchKnowledgeBase } = require("../src/services/retrievalService");
async function test() {
  const qs = [
    "What is the main topic of the uploaded document?",
    "What was the population of Mars in 2020?",
    "What are recent developments related to the document technology?",
  ];
  for (const q of qs) {
    const { results } = await searchKnowledgeBase(q, 5);
    console.log(`\nQ: ${q}`);
    results.forEach((r, i) => console.log(` ${i + 1}. dist=${r.distance?.toFixed(4)} type=${r.metadata?.sourceType} file=${r.metadata?.filename || r.metadata?.title}`));
  }
}
test();
