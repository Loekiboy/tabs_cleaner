// popup.js – Handles the popup UI logic

let allTabs = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Check if there's a pending or completed result from a previous session
  const stored = await chrome.storage.local.get(['cleanerResult', 'cleanerState', 'cleanerTabData']);

  if (stored.cleanerState === 'waiting') {
    // Still waiting for Gemini response
    showWaitingState();
    pollForResult();
    return;
  }

  if (stored.cleanerState === 'done' && stored.cleanerResult && stored.cleanerTabData) {
    // We have results to show
    showResults(stored.cleanerResult, stored.cleanerTabData);
    return;
  }

  // Normal state: show the input form
  showInputForm();
});

async function showInputForm() {
  // Gather all open tabs
  allTabs = await chrome.tabs.query({});
  document.getElementById('tabCount').textContent = allTabs.length;

  const submitBtn = document.getElementById('submitBtn');
  const requestField = document.getElementById('request');
  const statusEl = document.getElementById('status');

  document.getElementById('inputSection').style.display = 'block';
  document.getElementById('preview').style.display = 'none';

  submitBtn.addEventListener('click', async () => {
    const userRequest = requestField.value.trim();
    if (!userRequest) {
      statusEl.textContent = 'Please enter a request first.';
      statusEl.className = 'error';
      return;
    }

    submitBtn.disabled = true;

    // Build tab info to send to Gemini
    const tabData = allTabs.map((tab, index) => ({
      index: index,
      id: tab.id,
      title: tab.title || '(no title)',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      active: tab.active,
      pinned: tab.pinned,
      audible: !!tab.audible,
      discarded: !!tab.discarded,
      groupId: tab.groupId,
      incognito: tab.incognito,
      status: tab.status || 'unknown',
      lastAccessed: tab.lastAccessed
        ? new Date(tab.lastAccessed).toISOString()
        : 'unknown'
    }));

    // Build the prompt for Gemini
    const prompt = buildPrompt(tabData, userRequest);

    // Store tab data for later use
    await chrome.storage.local.set({
      cleanerTabData: tabData,
      cleanerState: 'waiting',
      cleanerResult: null
    });

    // Send to background script to handle Gemini interaction
    chrome.runtime.sendMessage({
      action: 'queryGemini',
      prompt: prompt
    });

    showWaitingState();
    pollForResult();
  });
}

function showWaitingState() {
  const statusEl = document.getElementById('status');
  const submitBtn = document.getElementById('submitBtn');

  if (submitBtn) submitBtn.disabled = true;
  statusEl.innerHTML = '<span class="spinner"></span> Gemini is analyzing... You can close this window and open it again.';
  statusEl.className = '';
}

async function pollForResult() {
  const checkInterval = setInterval(async () => {
    const stored = await chrome.storage.local.get(['cleanerState', 'cleanerResult', 'cleanerTabData']);

    if (stored.cleanerState === 'done') {
      clearInterval(checkInterval);
      if (stored.cleanerResult && stored.cleanerTabData) {
        showResults(stored.cleanerResult, stored.cleanerTabData);
      }
    } else if (stored.cleanerState === 'error') {
      clearInterval(checkInterval);
      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Error: ' + (stored.cleanerResult || 'Unknown error');
      statusEl.className = 'error';
      const submitBtn = document.getElementById('submitBtn');
      if (submitBtn) submitBtn.disabled = false;
      await chrome.storage.local.remove(['cleanerState', 'cleanerResult', 'cleanerTabData']);
    }
  }, 1500);
}

async function showResults(responseText, tabData) {
  const statusEl = document.getElementById('status');
  const previewEl = document.getElementById('preview');
  const previewList = document.getElementById('previewList');

  // Parse the response
  const tabsToClose = parseGeminiResponse(responseText, tabData);

  if (tabsToClose.length === 0) {
    statusEl.textContent = 'Gemini found no tabs to close.';
    statusEl.className = 'success';
    await chrome.storage.local.remove(['cleanerState', 'cleanerResult', 'cleanerTabData']);
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  // Automatically close tabs
  const currentTabs = await chrome.tabs.query({});
  const currentTabIds = new Set(currentTabs.map(t => t.id));
  const validTabIds = tabsToClose.map(t => t.id).filter(id => currentTabIds.has(id));

  if (validTabIds.length > 0) {
    await chrome.tabs.remove(validTabIds);
    statusEl.textContent = `Automatically closed ${validTabIds.length} tab(s)!`;
    statusEl.className = 'success';
  } else {
    statusEl.textContent = 'Tabs no longer exist.';
    statusEl.className = '';
  }

  // Show which tabs were closed
  previewList.innerHTML = '';
  tabsToClose.forEach(tab => {
    const div = document.createElement('div');
    div.className = 'tab-item';
    div.textContent = `${tab.title} — ${tab.url}`;
    previewList.appendChild(div);
  });

  previewEl.style.display = 'block';
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) submitBtn.disabled = false;

  // Cleanup storage
  await chrome.storage.local.remove(['cleanerState', 'cleanerResult', 'cleanerTabData']);

  // Refresh tab count
  allTabs = await chrome.tabs.query({});
  document.getElementById('tabCount').textContent = allTabs.length;
}

function buildPrompt(tabData, userRequest) {
  const now = new Date().toISOString();

  const tabListStr = tabData.map(t =>
    `[${t.index}] Title: "${t.title}" | URL: ${t.url} | Pinned: ${t.pinned} | Active: ${t.active} | Audible: ${t.audible} | Incognito: ${t.incognito} | Discarded: ${t.discarded} | GroupId: ${t.groupId} | Status: ${t.status} | Last Accessed: ${t.lastAccessed}`
  ).join('\n');

  return `You are an assistant that ONLY returns data. Do NOT converse. Do NOT provide explanations.

TASK: Review the list of open browser tabs below. The user wants to close certain tabs automatically based on their description.

USER REQUEST: "${userRequest}"

CURRENT DATE/TIME: ${now}

OPEN TABS:
${tabListStr}

INSTRUCTIONS:
- Analyze each tab based on the user's request.
- Return ONLY a JSON array containing the index numbers of the tabs that need to be closed.
- The format must be exactly: [0, 3, 5] (only numbers, no text).
- If no tab matches the request, return an empty array: []
- NEVER close the Gemini tab itself (URL contains gemini.google.com).
- ONLY return the JSON array, NOTHING else. No explanation, no text, just the array.`;
}

function parseGeminiResponse(responseText, tabData) {
  // Try to extract a JSON array from the response
  const cleaned = responseText.trim();

  // Try to find a JSON array in the response
  const arrayMatch = cleaned.match(/\[[\d,\s]*\]/);
  if (!arrayMatch) {
    return [];
  }

  try {
    const indices = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(indices)) return [];

    // Map indices back to tab data
    return indices
      .filter(i => typeof i === 'number' && i >= 0 && i < tabData.length)
      .map(i => tabData[i])
      // Don't close the Gemini tab
      .filter(t => !t.url.includes('gemini.google.com'));
  } catch {
    return [];
  }
}
