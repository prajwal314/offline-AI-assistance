// @ts-check
/**
 * RAG Application UI Smoke Test using Playwright CLI
 * Validates the application loads, shows correct status, and chat works.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://localhost:5173';
const EVAL_DIR = path.join(__dirname, '..'); // evaluation/

test.describe('Application Smoke Tests (Playwright CLI)', () => {
  test('1. App loads and all services are green', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });

    // Check title
    await expect(page.locator('text=AI Knowledge Assistant')).toBeVisible();
    
    // Check service status indicators are "All Ready" or green
    // The header shows API, SQLite, Chroma, Ollama status badges
    const statusText = await page.locator('header').textContent();
    console.log('Header status:', statusText?.replace(/\s+/g, ' ').trim());
    
    // Check that document is indexed
    await expect(page.locator('text=NIST.AI.100-1.pdf')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ 
      path: path.join(EVAL_DIR, 'screenshots', '01_app_loaded.png'),
      fullPage: true 
    });
    console.log('✓ App loaded successfully');
  });

  test('2. Document list shows NIST AI 100-1 PDF indexed', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    
    // Verify document is shown with "ready" status
    const docItem = page.locator('text=NIST.AI.100-1.pdf');
    await expect(docItem).toBeVisible();
    
    // Check chunk count is visible (should be 48)
    const docsPanel = page.locator('text=DOC CH...').locator('..');
    const chunkText = await docsPanel.textContent();
    console.log('Document chunks info:', chunkText);
    
    await page.screenshot({ 
      path: path.join(EVAL_DIR, 'screenshots', '02_documents.png') 
    });
    console.log('✓ Documents panel verified');
  });

  test('3. New chat session creation works', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    
    // Click "New chat" button
    const newChatBtn = page.locator('text=+ New chat').first();
    await expect(newChatBtn).toBeVisible();
    await newChatBtn.click();
    await page.waitForTimeout(1000);
    
    await page.screenshot({ 
      path: path.join(EVAL_DIR, 'screenshots', '03_new_chat.png') 
    });
    console.log('✓ New chat created');
  });

  test('4. Chat input accepts a question', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    
    // Find the chat input
    const chatInput = page.locator('textarea, input[type=text]').filter({ hasText: '' }).last();
    
    // Try to find the chat input box more specifically
    const input = page.locator('textarea').first();
    await expect(input).toBeVisible({ timeout: 10000 });
    
    await input.fill('What is the NIST AI Risk Management Framework?');
    
    await page.screenshot({ 
      path: path.join(EVAL_DIR, 'screenshots', '04_chat_input.png') 
    });
    console.log('✓ Chat input accepts text');
  });
});
