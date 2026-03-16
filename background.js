// background.js – Service worker that coordinates Gemini interaction

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'queryGemini') {
    handleGeminiQuery(message.prompt);
    // Don't wait for the response - popup will poll storage
    sendResponse({ started: true });
    return false;
  }

  if (message.action === 'geminiResponse') {
    // Response from content script with Gemini's answer
    chrome.storage.local.set({
      cleanerResult: message.text,
      cleanerState: 'done'
    });
    // Close the Gemini tab
    closeGeminiTab();
  }

  if (message.action === 'geminiError') {
    chrome.storage.local.set({
      cleanerResult: message.error,
      cleanerState: 'error'
    });
    closeGeminiTab();
  }

  if (message.action === 'closeGeminiTab') {
    closeGeminiTab();
  }
});

function closeGeminiTab() {
  chrome.storage.local.get(['geminiTabId'], (data) => {
    if (data.geminiTabId) {
      chrome.tabs.remove(data.geminiTabId).catch(() => {});
      chrome.storage.local.remove(['geminiTabId']);
    }
  });
}

async function handleGeminiQuery(prompt) {
  // Store the prompt so content script can retrieve it
  await chrome.storage.local.set({ geminiPrompt: prompt, geminiState: 'pending' });

  // Open Gemini in a new tab
  const geminiTab = await chrome.tabs.create({
    url: 'https://gemini.google.com/app',
    active: false
  });

  // Store the gemini tab ID so we can close it later
  await chrome.storage.local.set({ geminiTabId: geminiTab.id });

  // Set a timeout to handle case where Gemini doesn't respond
  setTimeout(async () => {
    const data = await chrome.storage.local.get(['cleanerState']);
    if (data.cleanerState === 'waiting') {
      await chrome.storage.local.set({
        cleanerResult: 'Timeout: Gemini did not respond within 2 minutes. Try again.',
        cleanerState: 'error'
      });
      closeGeminiTab();
    }
  }, 120000);
}
