// content.js – Content script that runs on gemini.google.com
// Handles injecting the prompt and reading the response

(async function () {
  // Check if there's a pending prompt
  const data = await chrome.storage.local.get(['geminiPrompt', 'geminiState']);
  if (data.geminiState !== 'pending' || !data.geminiPrompt) {
    return; // No pending request
  }

  // Mark as in-progress so we don't process twice
  await chrome.storage.local.set({ geminiState: 'processing' });

  const prompt = data.geminiPrompt;

  try {
    // Wait for the page to fully load - Gemini is a SPA, so wait longer
    await sleep(4000);

    // Attempt to click "New chat" or "Private chat" via the touch target to ensure a clean session
    try {
      const touchTargets = document.querySelectorAll('.mat-mdc-button-touch-target');
      for (const target of touchTargets) {
        const btn = target.closest('button, a, div[role="button"]');
        if (btn) {
          const text = btn.textContent.toLowerCase();
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          
          if (label.includes('new chat') || text.includes('new chat') || text.includes('nieuwe chat') || 
              label.includes('private') || text.includes('private')) {
            btn.click();
            await sleep(1500);
            break;
          }
        }
      }
    } catch (e) {}

    // Wait for the input element to appear
    const inputEl = await waitForInput(20000);
    if (!inputEl) {
      throw new Error('Could not find Gemini input field. Are you logged in?');
    }

    // Wait for page to stabilize
    await sleep(1500);

    // Type the prompt
    await typePrompt(inputEl, prompt);
    await sleep(800);

    // Find and click the send button
    const sent = await clickSend();
    if (!sent) {
      // Try pressing Enter as fallback
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      await sleep(500);
    }

    // Wait for the response
    const responseText = await waitForResponse(100000);

    if (!responseText) {
      throw new Error('No response received from Gemini.');
    }

    // Clear the stored prompt
    await chrome.storage.local.set({ geminiPrompt: '', geminiState: 'done' });

    // Send the response back to the background script
    chrome.runtime.sendMessage({
      action: 'geminiResponse',
      text: responseText
    });

  } catch (err) {
    await chrome.storage.local.set({ geminiState: 'error' });
    chrome.runtime.sendMessage({
      action: 'geminiError',
      error: err.message
    });
  }
})();

// --- Helper Functions ---

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForInput(timeout) {
  const selectors = [
    '.ql-editor[contenteditable="true"]',
    'rich-textarea .ql-editor',
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][aria-label*="Enter"]',
    'div[contenteditable="true"][aria-label]',
    'div[role="textbox"][contenteditable="true"]',
    'div.text-input-field [contenteditable="true"]',
    'textarea[aria-label]',
    'p[data-placeholder]',
  ];

  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // Check it's visible and likely the main input
        if (el.offsetParent !== null || el.offsetHeight > 0) {
          return el;
        }
      }
    }
    await sleep(500);
  }

  // Final attempt: any contenteditable
  const fallback = document.querySelector('[contenteditable="true"]');
  return fallback;
}

async function typePrompt(el, text) {
  el.focus();
  await sleep(200);

  // Method 1: execCommand insertText (works well with contenteditable)
  el.textContent = '';
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  const success = document.execCommand('insertText', false, text);
  if (success && el.textContent.trim().length > 10) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Method 2: Set textContent directly
  el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);

  if (el.textContent.trim().length > 10) return;

  // Method 3: innerHTML with paragraph tags
  el.innerHTML = '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function clickSend() {
  // Try specific selectors first
  const selectors = [
    'button.send-button',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="Verzend"]',
    'button[aria-label*="Submit"]',
    'button[data-tooltip*="Send"]',
    '.send-button-container button',
  ];

  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
  }

  // Look for buttons by content/icon
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
    const matIcon = btn.querySelector('mat-icon');
    const iconText = matIcon ? (matIcon.getAttribute('fonticon') || matIcon.textContent || '').toLowerCase() : '';

    if (
      label.includes('send') || label.includes('verzend') || label.includes('submit') ||
      tooltip.includes('send') ||
      iconText === 'send' || iconText === 'arrow_upward'
    ) {
      if (!btn.disabled) {
        btn.click();
        return true;
      }
    }
  }

  // Look for SVG arrow icons in buttons (common in modern Gemini)
  for (const btn of buttons) {
    const svg = btn.querySelector('svg');
    if (svg && btn.closest('.input-area, .chat-input, .bottom, [class*="input"]')) {
      if (!btn.disabled) {
        btn.click();
        return true;
      }
    }
  }

  return false;
}

async function waitForResponse(timeout) {
  const start = Date.now();

  // Wait for initial response to start appearing
  await sleep(5000);

  const responseSelectors = [
    // Common Gemini response selectors
    '.model-response-text',
    'model-response .content',
    'message-content',
    '.response-container .markdown',
    '.markdown-main-panel',
    '.response-content',
    // Modern Gemini
    '[class*="response"] [class*="text"]',
    '[class*="model"] [class*="content"]',
    '.conversation-container .model-response',
  ];

  let lastText = '';
  let stableCount = 0;
  const requiredStable = 5; // Must be stable for 5 seconds

  while (Date.now() - start < timeout) {
    let responseText = '';

    // Try all selectors
    for (const selector of responseSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const last = elements[elements.length - 1];
          const text = last.textContent.trim();
          if (text.length > responseText.length) {
            responseText = text;
          }
        }
      } catch (e) {
        // Selector might be invalid
      }
    }

    // Fallback: look for message turns/bubbles
    if (!responseText) {
      const turnSelectors = [
        '.conversation-turn',
        '[data-turn-id]',
        '.chat-turn',
        '.turn-content',
        '[class*="turn"]',
        '[class*="message"]',
      ];

      for (const sel of turnSelectors) {
        try {
          const turns = document.querySelectorAll(sel);
          if (turns.length >= 2) { // At least our prompt + response
            const lastTurn = turns[turns.length - 1];
            const text = lastTurn.textContent.trim();
            if (text && !text.includes(lastText.substring(0, 50))) {
              responseText = text;
            }
          }
        } catch (e) {}
      }
    }

    // Ultra fallback: look for anything with a JSON array
    if (!responseText) {
      const allElements = document.querySelectorAll('div, p, span, pre, code');
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text.match(/^\[[\d,\s]*\]$/) && text.length > 1) {
          responseText = text;
          break;
        }
      }
    }

    if (responseText && responseText.length > 0) {
      if (responseText === lastText) {
        stableCount++;
        if (stableCount >= requiredStable) {
          return responseText;
        }
      } else {
        stableCount = 0;
        lastText = responseText;
      }
    }

    await sleep(1000);
  }

  return lastText || null;
}
