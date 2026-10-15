# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01_smoke.spec.js >> Application Smoke Tests (Playwright CLI) >> 2. Document list shows NIST AI 100-1 PDF indexed
- Location: tests\01_smoke.spec.js:36:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=NIST.AI.100-1.pdf')
Expected: visible
Error: strict mode violation: locator('text=NIST.AI.100-1.pdf') resolved to 10 elements:
    1) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate pr-1">NIST.AI.100-1.pdf</div> aka getByText('NIST.AI.100-1.pdf').first()
    2) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka getByText('NIST.AI.100-1.pdf').nth(1)
    3) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka getByText('NIST.AI.100-1.pdf').nth(2)
    4) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka getByText('NIST.AI.100-1.pdf').nth(3)
    5) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka getByText('NIST.AI.100-1.pdf').nth(4)
    6) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka getByText('NIST.AI.100-1.pdf').nth(5)
    7) <div class="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">The Manage function in the NIST AI RMF 1.0 focuse…</div> aka getByText('The Manage function in the')
    8) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka locator('div:nth-child(2) > .px-4.py-4 > .pt-3 > .grid > li > .flex.items-start > .flex-1 > .text-xs').first()
    9) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka locator('div:nth-child(2) > .px-4.py-4 > .pt-3 > .grid > li:nth-child(2) > .flex.items-start > .flex-1 > .text-xs')
    10) <div class="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">NIST.AI.100-1.pdf</div> aka locator('div:nth-child(2) > .px-4.py-4 > .pt-3 > .grid > li:nth-child(3) > .flex.items-start > .flex-1 > .text-xs')

Call log:
  - Expect "toBeVisible" locator('text=NIST.AI.100-1.pdf') with timeout 5000ms
  - waiting for locator('text=NIST.AI.100-1.pdf')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - generic [ref=e7]: ◉
        - generic [ref=e8]:
          - generic [ref=e9]: AI Knowledge Assistant
          - generic [ref=e10]: Offline RAG Knowledge Platform
      - generic [ref=e11]: Qwen3 · Chroma · SQLite · ↔ drag dividers / corners to resize
      - generic [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]:
            - generic "Backend operational" [ref=e15]: API
            - generic "Metadata DB ready" [ref=e19]: SQLite
            - generic "48 vectors indexed" [ref=e23]: Chroma
            - generic "LLM ready (qwen3:4b)" [ref=e27]: Ollama
            - button "↻" [ref=e30] [cursor=pointer]
          - generic "All local services online — Q&A ready" [ref=e32]: All Ready
        - generic [ref=e34]: Local
        - button "🌙" [ref=e36] [cursor=pointer]
        - button "Reset" [ref=e37] [cursor=pointer]
  - main [ref=e38]:
    - generic [ref=e39]:
      - generic [ref=e40]:
        - generic [ref=e42]:
          - generic [ref=e43]:
            - heading "Knowledge Base" [level=2] [ref=e45]
            - button "Refresh" [ref=e46] [cursor=pointer]
          - generic [ref=e47]:
            - generic [ref=e48]:
              - generic [ref=e49]: Documents
              - generic [ref=e50]: "1"
              - generic [ref=e51]: 1 ready
            - generic [ref=e52]:
              - generic [ref=e53]: Ready
              - generic [ref=e54]: "1"
              - generic [ref=e55]: 0 failed
            - generic [ref=e56]:
              - generic [ref=e57]: Web Sources
              - generic [ref=e58]: "0"
              - generic [ref=e59]: 0 total
            - generic [ref=e60]:
              - generic [ref=e61]: Total Chunks
              - generic [ref=e62]: "48"
              - generic [ref=e63]: Knowledge
            - generic [ref=e64]:
              - generic [ref=e65]: Doc Chunks
              - generic [ref=e66]: "48"
              - generic [ref=e67]: From PDFs
            - generic [ref=e68]:
              - generic [ref=e69]: Web Chunks
              - generic [ref=e70]: "0"
              - generic [ref=e71]: From web
        - generic "Drag corner to resize · double-click to reset" [ref=e72]
      - generic "Drag to resize · double-click to reset" [ref=e75]
      - generic [ref=e77]:
        - generic [ref=e78]:
          - generic [ref=e79]:
            - generic [ref=e80]: 🌐
            - generic [ref=e81]:
              - heading "Internet Research" [level=2] [ref=e82]
              - paragraph [ref=e83]: Web → local KB · Q&A stays offline
          - generic [ref=e85]:
            - generic [ref=e86]:
              - generic [ref=e87]: Status
              - generic [ref=e88]: idle
              - generic [ref=e90]: idle
            - generic [ref=e91]:
              - generic [ref=e92]: Documents
              - generic [ref=e93]: "1"
              - generic [ref=e94]: Indexed
            - generic [ref=e95]:
              - generic [ref=e96]: Web Sources
              - generic [ref=e97]: 0 / 0
              - generic [ref=e98]: Collected
            - generic [ref=e99]:
              - generic [ref=e100]: Total Chunks
              - generic [ref=e101]: "48"
              - generic [ref=e102]: Embeddings
            - generic [ref=e103]:
              - generic [ref=e104]: Progress
              - generic [ref=e105]: 0 / 0
              - generic [ref=e106]: failed 0
            - generic [ref=e107]:
              - generic [ref=e108]: Chunks +
              - generic [ref=e109]: "0"
              - generic [ref=e110]: This run
        - generic "Drag corner to resize · double-click to reset" [ref=e112]
        - generic [ref=e115]: React → Express → SQLite / Chroma / Ollama → RAGQ&A offline · Web only for Research
    - generic "Drag to resize · double-click to reset" [ref=e116]
    - generic [ref=e118]:
      - generic [ref=e119]:
        - generic [ref=e121]:
          - generic [ref=e122]:
            - generic [ref=e123]:
              - heading "Documents" [level=2] [ref=e124]
              - paragraph [ref=e125]: 1 PDFs indexed
            - generic [ref=e126] [cursor=pointer]:
              - generic [ref=e127]: +
              - text: Upload PDF
            - button "Meta" [ref=e128] [cursor=pointer]
          - list [ref=e130]:
            - listitem [ref=e131]:
              - generic [ref=e132]: PDF
              - generic [ref=e133]:
                - generic [ref=e134]: NIST.AI.100-1.pdf
                - generic [ref=e135]:
                  - generic [ref=e136]: ready
                  - generic [ref=e137]: Processed
              - button "×" [ref=e138] [cursor=pointer]
        - generic "Drag corner to resize · double-click to reset" [ref=e139]
      - generic "Drag to resize · double-click to reset" [ref=e142]
      - button "Search Internet & Build Knowledge Base" [ref=e146] [cursor=pointer]
      - generic [ref=e147]:
        - generic [ref=e148]:
          - generic [ref=e149]:
            - generic [ref=e150]:
              - heading "Research Sources" [level=3] [ref=e151]
              - paragraph [ref=e152]: 0 sources
            - button "Refresh" [ref=e153] [cursor=pointer]
          - table [ref=e155]:
            - rowgroup [ref=e156]:
              - row [ref=e157]:
                - columnheader "Source" [ref=e158]
                - columnheader "Status" [ref=e159]
                - columnheader "Open" [ref=e160]
            - rowgroup [ref=e161]:
              - row [ref=e162]:
                - cell "No sources yet — run Internet Research." [ref=e163]
        - generic "Drag corner to resize · double-click to reset" [ref=e164]
    - generic "Drag to resize · double-click to reset" [ref=e167]
    - generic [ref=e170]:
      - generic [ref=e172]:
        - heading "AI Knowledge Assistant" [level=2] [ref=e173]
        - paragraph [ref=e174]: RAG answers with sources · context preserved
      - generic [ref=e175]:
        - complementary [ref=e176]:
          - generic [ref=e177]:
            - button "+ New chat" [ref=e178] [cursor=pointer]:
              - generic [ref=e179]: +
              - text: New chat
            - textbox "Search chats..." [ref=e180]
          - generic [ref=e181]: Sessions · 1
          - generic [ref=e182]:
            - button "New chat Start a fresh session" [ref=e183] [cursor=pointer]:
              - generic [ref=e184]: New chat
              - generic [ref=e185]: Start a fresh session
            - generic "Who authored the AI RMF 1.0 publication?" [ref=e186] [cursor=pointer]:
              - generic [ref=e189]:
                - generic [ref=e190]: 2 msgs
                - generic [ref=e191]: ·
                - generic [ref=e192]: 10/15/2026, 11:12:46 PM
              - generic [ref=e193]: What does the Manage function focus on?
        - generic "Drag to resize sessions · double-click to reset" [ref=e194]
        - generic [ref=e196]:
          - generic [ref=e197]:
            - generic [ref=e198]:
              - generic [ref=e199]: Who authored the AI RMF 1.0 publication?
              - generic [ref=e200]: 2 messages in this session · context preserved
            - button "Retrieval" [ref=e201] [cursor=pointer]
          - generic [ref=e202]:
            - generic [ref=e203]:
              - generic [ref=e204]: Who authored the AI RMF 1.0 publication?
              - generic [ref=e206]:
                - generic [ref=e207]:
                  - generic [ref=e208]:
                    - generic [ref=e209]: ✦
                    - text: Assistant
                  - generic [ref=e210]: 10/15/2026, 10:54:13 PM
                - generic [ref=e212]:
                  - button "▸ Show thinking" [ref=e214] [cursor=pointer]:
                    - generic [ref=e215]: ▸
                    - text: Show thinking
                  - generic [ref=e216]: "The National Institute of Standards and Technology (NIST) authored the AI RMF 1.0 publication. This conclusion is based directly on the provided context. The document explicitly identifies NIST as the issuing organization in the publication details on page 2 (Chunk 1), where it states: \"U.S. Department of Commerce\" and \"National Institute of Standards and Technology\" as the entities responsible for the publication. The title of the document itself (\"NIST"
                - generic [ref=e217]:
                  - generic [ref=e218]: Sources (5)
                  - list [ref=e219]:
                    - listitem [ref=e220]:
                      - generic [ref=e221]:
                        - generic [ref=e222]: 📄
                        - generic [ref=e223]:
                          - generic [ref=e224]: NIST.AI.100-1.pdf
                          - generic [ref=e225]: Page 1 · chunk 0
                        - generic [ref=e226]: dist 0.297
                    - listitem [ref=e227]:
                      - generic [ref=e228]:
                        - generic [ref=e229]: 📄
                        - generic [ref=e230]:
                          - generic [ref=e231]: NIST.AI.100-1.pdf
                          - generic [ref=e232]: Page 2 · chunk 1
                        - generic [ref=e233]: dist 0.353
                    - listitem [ref=e234]:
                      - generic [ref=e235]:
                        - generic [ref=e236]: 📄
                        - generic [ref=e237]:
                          - generic [ref=e238]: NIST.AI.100-1.pdf
                          - generic [ref=e239]: Page 3 · chunk 2
                        - generic [ref=e240]: dist 0.405
                    - listitem [ref=e241]:
                      - generic [ref=e242]:
                        - generic [ref=e243]: 📄
                        - generic [ref=e244]:
                          - generic [ref=e245]: NIST.AI.100-1.pdf
                          - generic [ref=e246]: Page 47 · chunk 46
                        - generic [ref=e247]: dist 0.415
                    - listitem [ref=e248]:
                      - generic [ref=e249]:
                        - generic [ref=e250]: 📄
                        - generic [ref=e251]:
                          - generic [ref=e252]: NIST.AI.100-1.pdf
                          - generic [ref=e253]: Page 48 · chunk 47
                        - generic [ref=e254]: dist 0.422
            - generic [ref=e255]:
              - generic [ref=e256]: What does the Manage function focus on?
              - generic [ref=e258]:
                - generic [ref=e259]:
                  - generic [ref=e260]:
                    - generic [ref=e261]: ✦
                    - text: Assistant
                  - generic [ref=e262]: 10/15/2026, 11:06:15 PM
                - generic [ref=e264]:
                  - button "▸ Show thinking" [ref=e266] [cursor=pointer]:
                    - generic [ref=e267]: ▸
                    - text: Show thinking
                  - generic [ref=e268]: "The Manage function in the NIST AI RMF 1.0 focuses on the continuous management of AI risks and benefits throughout the AI lifecycle, specifically through structured prioritization, response planning, third-party oversight, and ongoing monitoring activities. This is explicitly defined in Table 4 of the NIST AI 100-1 document (pages 37–38). Key aspects of the Manage function's focus include: - **Risk prioritization and response**: MANAGE 1 addresses how AI risks identified through assessments (from the MAP and MEASURE functions) are prioritized based on impact, likelihood, and resources. It requires developing documented responses for high-priority risks (e.g., mitigating, transferring, avoiding, or accepting risks) and tracking negative residual risks (unmitigated risks) affecting downstream users. - **Strategy implementation for benefits and impact minimization**: MANAGE 2 focuses on planning and executing strategies to maximize AI benefits while minimizing negative impacts, including resource allocation for risk management, sustaining system value, and procedures for responding to previously unknown risks. - **Third-party risk management**: MANAGE 3 handles monitoring and control of AI risks and benefits from external entities, such as pre-trained models used in development, ensuring documented risk controls. - **Ongoing monitoring and communication**: MANAGE 4 ensures risk treatments, response plans, and communication strategies are regularly documented and monitored, covering post-deployment activities like user input capture, incident response, decommissioning, and transparent communication with affected communities. This structured approach enables organizations to proactively address AI risks while aligning with their goals, legal requirements, and resource constraints, as emphasized in the NIST AI RMF 1.0 framework. All details are directly sourced from the provided [DOCUMENT] (NIST.AI.100-1.pdf, pages 37–38)."
                - generic [ref=e269]:
                  - generic [ref=e270]: Sources (3)
                  - list [ref=e271]:
                    - listitem [ref=e272]:
                      - generic [ref=e273]:
                        - generic [ref=e274]: 📄
                        - generic [ref=e275]:
                          - generic [ref=e276]: NIST.AI.100-1.pdf
                          - generic [ref=e277]: Page 1 · chunk 0
                        - generic [ref=e278]: dist 0.591
                    - listitem [ref=e279]:
                      - generic [ref=e280]:
                        - generic [ref=e281]: 📄
                        - generic [ref=e282]:
                          - generic [ref=e283]: NIST.AI.100-1.pdf
                          - generic [ref=e284]: Page 37 · chunk 36
                        - generic [ref=e285]: dist 0.604
                    - listitem [ref=e286]:
                      - generic [ref=e287]:
                        - generic [ref=e288]: 📄
                        - generic [ref=e289]:
                          - generic [ref=e290]: NIST.AI.100-1.pdf
                          - generic [ref=e291]: Page 38 · chunk 37
                        - generic [ref=e292]: dist 0.626
          - generic [ref=e293]:
            - generic [ref=e294]:
              - textbox "Continue this session..." [ref=e295]
              - button "↑" [disabled] [ref=e296]
            - generic [ref=e298]: Chatting in this session — history is used as context.
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
> 41 |     await expect(docItem).toBeVisible();
     |                           ^ Error: expect(locator).toBeVisible() failed
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
  77 |     await expect(input).toBeVisible({ timeout: 10000 });
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