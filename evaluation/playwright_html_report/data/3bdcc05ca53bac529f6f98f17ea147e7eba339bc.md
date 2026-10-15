# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01_smoke.spec.js >> Application Smoke Tests (Playwright CLI) >> 4. Chat input accepts a question
- Location: tests\01_smoke.spec.js:69:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('textarea').first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('textarea').first() with timeout 10000ms
  - waiting for locator('textarea').first()

```

```yaml
- banner:
  - text: ◉ AI Knowledge Assistant Offline RAG Knowledge Platform Qwen3 · Chroma · SQLite · ↔ drag dividers / corners to resize API SQLite Chroma Ollama
  - button "↻"
  - text: All Ready Local
  - button "🌙"
  - button "Reset"
- main:
  - heading "Knowledge Base" [level=2]
  - button "Refresh"
  - text: Documents 1 1 ready Ready 1 0 failed Web Sources 0 0 total Total Chunks 48 Knowledge Doc Chunks 48 From PDFs Web Chunks 0 From web
  - img
  - text: 🌐
  - heading "Internet Research" [level=2]
  - paragraph: Web → local KB · Q&A stays offline
  - text: Status idle idle Documents 1 Indexed Web Sources 0 / 0 Collected Total Chunks 48 Embeddings Progress 0 / 0 failed 0 Chunks + 0 This run
  - img
  - text: React → Express → SQLite / Chroma / Ollama → RAG Q&A offline · Web only for Research
  - heading "Documents" [level=2]
  - paragraph: 1 PDFs indexed
  - text: + Upload PDF
  - button "Meta"
  - list:
    - listitem:
      - text: PDF NIST.AI.100-1.pdf ready Processed
      - button "×"
  - img
  - button "Search Internet & Build Knowledge Base"
  - heading "Research Sources" [level=3]
  - paragraph: 0 sources
  - button "Refresh"
  - table:
    - rowgroup:
      - row "Source Status Open":
        - columnheader "Source"
        - columnheader "Status"
        - columnheader "Open"
    - rowgroup:
      - row "No sources yet — run Internet Research.":
        - cell "No sources yet — run Internet Research."
  - img
  - heading "AI Knowledge Assistant" [level=2]
  - paragraph: RAG answers with sources · context preserved
  - complementary:
    - button "+ New chat"
    - textbox "Search chats..."
    - text: Sessions · 1
    - button "New chat Start a fresh session"
    - text: Who authored the AI RMF 1.0 publication? 2 msgs · 10/15/2026, 11:12:46 PM What does the Manage function focus on?
  - text: Who authored the AI RMF 1.0 publication? 2 messages in this session · context preserved
  - button "Retrieval"
  - text: Who authored the AI RMF 1.0 publication? ✦ Assistant 10/15/2026, 10:54:13 PM
  - button "▸ Show thinking"
  - text: "The National Institute of Standards and Technology (NIST) authored the AI RMF 1.0 publication. This conclusion is based directly on the provided context. The document explicitly identifies NIST as the issuing organization in the publication details on page 2 (Chunk 1), where it states: \"U.S. Department of Commerce\" and \"National Institute of Standards and Technology\" as the entities responsible for the publication. The title of the document itself (\"NIST Sources (5)"
  - list:
    - listitem: 📄 NIST.AI.100-1.pdf Page 1 · chunk 0 dist 0.297
    - listitem: 📄 NIST.AI.100-1.pdf Page 2 · chunk 1 dist 0.353
    - listitem: 📄 NIST.AI.100-1.pdf Page 3 · chunk 2 dist 0.405
    - listitem: 📄 NIST.AI.100-1.pdf Page 47 · chunk 46 dist 0.415
    - listitem: 📄 NIST.AI.100-1.pdf Page 48 · chunk 47 dist 0.422
  - text: What does the Manage function focus on? ✦ Assistant 10/15/2026, 11:06:15 PM
  - button "▸ Show thinking"
  - text: "The Manage function in the NIST AI RMF 1.0 focuses on the continuous management of AI risks and benefits throughout the AI lifecycle, specifically through structured prioritization, response planning, third-party oversight, and ongoing monitoring activities. This is explicitly defined in Table 4 of the NIST AI 100-1 document (pages 37–38). Key aspects of the Manage function's focus include: - **Risk prioritization and response**: MANAGE 1 addresses how AI risks identified through assessments (from the MAP and MEASURE functions) are prioritized based on impact, likelihood, and resources. It requires developing documented responses for high-priority risks (e.g., mitigating, transferring, avoiding, or accepting risks) and tracking negative residual risks (unmitigated risks) affecting downstream users. - **Strategy implementation for benefits and impact minimization**: MANAGE 2 focuses on planning and executing strategies to maximize AI benefits while minimizing negative impacts, including resource allocation for risk management, sustaining system value, and procedures for responding to previously unknown risks. - **Third-party risk management**: MANAGE 3 handles monitoring and control of AI risks and benefits from external entities, such as pre-trained models used in development, ensuring documented risk controls. - **Ongoing monitoring and communication**: MANAGE 4 ensures risk treatments, response plans, and communication strategies are regularly documented and monitored, covering post-deployment activities like user input capture, incident response, decommissioning, and transparent communication with affected communities. This structured approach enables organizations to proactively address AI risks while aligning with their goals, legal requirements, and resource constraints, as emphasized in the NIST AI RMF 1.0 framework. All details are directly sourced from the provided [DOCUMENT] (NIST.AI.100-1.pdf, pages 37–38). Sources (3)"
  - list:
    - listitem: 📄 NIST.AI.100-1.pdf Page 1 · chunk 0 dist 0.591
    - listitem: 📄 NIST.AI.100-1.pdf Page 37 · chunk 36 dist 0.604
    - listitem: 📄 NIST.AI.100-1.pdf Page 38 · chunk 37 dist 0.626
  - textbox "Continue this session..."
  - button "↑" [disabled]
  - text: Chatting in this session — history is used as context.
```

# Test source

```ts
  1  | // @ts-check
  2  | /**
  3  |  * RAG Application UI Smoke Test using Playwright CLI
  4  |  * Validates the application loads, shows correct status, and chat works.
  5  |  */
  6  | const { test, expect } = require('@playwright/test');
  7  | const fs = require('fs');
  8  | const path = require('path');
  9  | 
  10 | const APP_URL = 'http://localhost:5173';
  11 | const EVAL_DIR = path.join(__dirname, '..'); // evaluation/
  12 | 
  13 | test.describe('Application Smoke Tests (Playwright CLI)', () => {
  14 |   test('1. App loads and all services are green', async ({ page }) => {
  15 |     await page.goto(APP_URL, { waitUntil: 'networkidle' });
  16 | 
  17 |     // Check title
  18 |     await expect(page.locator('text=AI Knowledge Assistant')).toBeVisible();
  19 |     
  20 |     // Check service status indicators are "All Ready" or green
  21 |     // The header shows API, SQLite, Chroma, Ollama status badges
  22 |     const statusText = await page.locator('header').textContent();
  23 |     console.log('Header status:', statusText?.replace(/\s+/g, ' ').trim());
  24 |     
  25 |     // Check that document is indexed
  26 |     await expect(page.locator('text=NIST.AI.100-1.pdf')).toBeVisible();
  27 |     
  28 |     // Take screenshot
  29 |     await page.screenshot({ 
  30 |       path: path.join(EVAL_DIR, 'screenshots', '01_app_loaded.png'),
  31 |       fullPage: true 
  32 |     });
  33 |     console.log('✓ App loaded successfully');
  34 |   });
  35 | 
  36 |   test('2. Document list shows NIST AI 100-1 PDF indexed', async ({ page }) => {
  37 |     await page.goto(APP_URL, { waitUntil: 'networkidle' });
  38 |     
  39 |     // Verify document is shown with "ready" status
  40 |     const docItem = page.locator('text=NIST.AI.100-1.pdf');
  41 |     await expect(docItem).toBeVisible();
  42 |     
  43 |     // Check chunk count is visible (should be 48)
  44 |     const docsPanel = page.locator('text=DOC CH...').locator('..');
  45 |     const chunkText = await docsPanel.textContent();
  46 |     console.log('Document chunks info:', chunkText);
  47 |     
  48 |     await page.screenshot({ 
  49 |       path: path.join(EVAL_DIR, 'screenshots', '02_documents.png') 
  50 |     });
  51 |     console.log('✓ Documents panel verified');
  52 |   });
  53 | 
  54 |   test('3. New chat session creation works', async ({ page }) => {
  55 |     await page.goto(APP_URL, { waitUntil: 'networkidle' });
  56 |     
  57 |     // Click "New chat" button
  58 |     const newChatBtn = page.locator('text=+ New chat').first();
  59 |     await expect(newChatBtn).toBeVisible();
  60 |     await newChatBtn.click();
  61 |     await page.waitForTimeout(1000);
  62 |     
  63 |     await page.screenshot({ 
  64 |       path: path.join(EVAL_DIR, 'screenshots', '03_new_chat.png') 
  65 |     });
  66 |     console.log('✓ New chat created');
  67 |   });
  68 | 
  69 |   test('4. Chat input accepts a question', async ({ page }) => {
  70 |     await page.goto(APP_URL, { waitUntil: 'networkidle' });
  71 |     
  72 |     // Find the chat input
  73 |     const chatInput = page.locator('textarea, input[type=text]').filter({ hasText: '' }).last();
  74 |     
  75 |     // Try to find the chat input box more specifically
  76 |     const input = page.locator('textarea').first();
> 77 |     await expect(input).toBeVisible({ timeout: 10000 });
     |                         ^ Error: expect(locator).toBeVisible() failed
  78 |     
  79 |     await input.fill('What is the NIST AI Risk Management Framework?');
  80 |     
  81 |     await page.screenshot({ 
  82 |       path: path.join(EVAL_DIR, 'screenshots', '04_chat_input.png') 
  83 |     });
  84 |     console.log('✓ Chat input accepts text');
  85 |   });
  86 | });
  87 | 
```