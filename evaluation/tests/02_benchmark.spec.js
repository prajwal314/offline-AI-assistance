// @ts-check
/**
 * RAG Benchmark Test using Playwright CLI
 * 
 * Executes all 30 evaluation questions through the real application UI,
 * captures responses, sources, latency, and saves raw_results.jsonl
 * 
 * Uses npx playwright test (the modern playwright-cli successor)
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://localhost:5173';
const EVAL_DIR = path.join(__dirname, '..');
const RAW_RESULTS_PATH = path.join(EVAL_DIR, 'raw_results.jsonl');
const DATASET_PATH = path.join(EVAL_DIR, 'dataset.json');
const SCREENSHOTS_DIR = path.join(EVAL_DIR, 'screenshots');

// Load dataset
const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));

// Ensure directories exist
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
// Clear previous raw results
if (fs.existsSync(RAW_RESULTS_PATH)) fs.unlinkSync(RAW_RESULTS_PATH);

function appendRawResult(record) {
  fs.appendFileSync(RAW_RESULTS_PATH, JSON.stringify(record) + '\n', 'utf8');
}

// Helper: ask a question through the chat UI and capture response
async function askQuestion(page, question, questionId) {
  const t0 = Date.now();
  
  // Navigate to fresh page state
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Click New Chat to start fresh
  try {
    const newChatBtn = page.locator('button:has-text("+ New chat"), button:has-text("New chat")').first();
    if (await newChatBtn.isVisible({ timeout: 3000 })) {
      await newChatBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {}
  
  // Find the textarea / chat input
  const textarea = page.locator('textarea').last();
  await expect(textarea).toBeVisible({ timeout: 15000 });
  
  // Clear and type the question
  await textarea.fill('');
  await textarea.type(question, { delay: 5 });
  
  const retrievalStart = Date.now();
  
  // Submit (Enter key)
  await textarea.press('Enter');
  
  // Wait for a response — look for streaming content or "done" state
  // The app streams tokens, so we wait for the sources panel or answer text to appear
  try {
    // Wait up to 90s for an answer to appear (LLM can be slow)
    await page.waitForSelector(
      '[class*="source"], text=Sources, .answer, [data-testid="answer"], text=I could not find',
      { timeout: 90000 }
    );
  } catch {
    // Fallback: just wait a reasonable time
    await page.waitForTimeout(15000);
  }
  
  // Extra buffer for streaming to complete
  await page.waitForTimeout(3000);
  
  const totalLatencyMs = Date.now() - t0;
  const retrievalLatencyMs = Date.now() - retrievalStart;
  
  // Take screenshot
  const screenshotPath = path.join(SCREENSHOTS_DIR, `q${questionId.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  
  // Extract the answer text from the UI
  let answerText = '';
  let sourcesData = [];
  let errorMsg = null;
  
  try {
    // Try to get main answer content
    // The app renders answers in a specific area — look for common patterns
    const possibleAnswerSelectors = [
      '[class*="message"] p',
      '[class*="answer"]',
      '[class*="chat"] p',
      '.prose',
      'article p',
    ];
    
    for (const sel of possibleAnswerSelectors) {
      const els = page.locator(sel);
      const count = await els.count();
      if (count > 0) {
        const texts = [];
        for (let i = 0; i < Math.min(count, 10); i++) {
          const t = await els.nth(i).textContent();
          if (t && t.trim().length > 20) texts.push(t.trim());
        }
        if (texts.length > 0) {
          answerText = texts.join('\n');
          break;
        }
      }
    }
    
    // If no structured answer found, get all text from chat panel
    if (!answerText) {
      const chatPanel = page.locator('[class*="chat"], main').last();
      answerText = await chatPanel.textContent() || '';
      // Trim it
      answerText = answerText.replace(/\s+/g, ' ').trim().slice(0, 3000);
    }
  } catch (e) {
    errorMsg = `Answer extraction failed: ${e.message}`;
  }
  
  // Extract sources
  try {
    const sourceTexts = await page.locator('text=NIST.AI.100-1.pdf').all();
    for (const el of sourceTexts) {
      const parentText = await el.locator('..').textContent() || '';
      sourcesData.push(parentText.trim().slice(0, 200));
    }
  } catch {}
  
  return {
    questionId,
    question,
    answerText: answerText.slice(0, 5000),
    sources: sourcesData,
    totalLatencyMs,
    retrievalLatencyMs,
    screenshotPath,
    errorMsg,
    timestamp: new Date().toISOString(),
  };
}

// Run all questions
test.describe('RAG Benchmark — All 30 Questions (Playwright CLI)', () => {
  // Answerable document questions
  const docQuestions = dataset.filter(q => !q.answer_unavailable_in_corpus);
  const unanswerableQuestions = dataset.filter(q => q.answer_unavailable_in_corpus);
  
  for (const q of docQuestions) {
    test(`[${q.id}] ${q.query.slice(0, 60)}`, async ({ page }) => {
      console.log(`\n▶ Running ${q.id}: ${q.query.slice(0, 80)}`);
      
      const result = await askQuestion(page, q.query, q.id);
      
      // Check that we got some response
      const hasAnswer = result.answerText.length > 50;
      const isInsufficient = result.answerText.toLowerCase().includes('could not find') ||
                              result.answerText.toLowerCase().includes('insufficient');
      
      // Store raw result
      appendRawResult({
        ...result,
        questionType: q.question_type,
        expectedSourceType: q.expected_source_type,
        requiredFacts: q.required_facts,
        expectedAnswer: q.expected_answer,
        answerUnavailable: q.answer_unavailable_in_corpus,
        hasAnswer,
        isInsufficient,
        run_id: `playwright-${Date.now()}`,
      });
      
      // For answerable questions, we expect a real answer
      if (!q.answer_unavailable_in_corpus) {
        console.log(`  Answer (${result.answerText.length} chars): ${result.answerText.slice(0, 150)}...`);
        console.log(`  Latency: ${result.totalLatencyMs}ms`);
        console.log(`  Sources found: ${result.sources.length}`);
      }
      
      // Soft assertion — we want all tests to complete even if some produce no answer
      if (result.errorMsg) {
        console.warn(`  ⚠ Error: ${result.errorMsg}`);
      }
    });
  }
  
  for (const q of unanswerableQuestions) {
    test(`[${q.id}] UNANSWERABLE: ${q.query.slice(0, 50)}`, async ({ page }) => {
      console.log(`\n▶ Running UNANSWERABLE ${q.id}: ${q.query.slice(0, 80)}`);
      
      const result = await askQuestion(page, q.query, q.id);
      
      const refusedCorrectly = result.answerText.toLowerCase().includes('could not find') ||
                                result.answerText.toLowerCase().includes('not find enough') ||
                                result.answerText.toLowerCase().includes('insufficient') ||
                                result.answerText.toLowerCase().includes('no information');
      
      appendRawResult({
        ...result,
        questionType: q.question_type,
        expectedSourceType: q.expected_source_type,
        requiredFacts: q.required_facts,
        expectedAnswer: q.expected_answer,
        answerUnavailable: q.answer_unavailable_in_corpus,
        hasAnswer: result.answerText.length > 50,
        refusedCorrectly,
        hallucinated: !refusedCorrectly,
        run_id: `playwright-${Date.now()}`,
      });
      
      console.log(`  Refused correctly: ${refusedCorrectly}`);
      console.log(`  Response: ${result.answerText.slice(0, 200)}`);
    });
  }
});
