# Web Page Cleaner

A small Chrome/Edge extension that uses [Gemini](https://gemini.google.com/) to automatically decide which tabs to close based on a natural-language description.

## What it does
- Collects metadata from all open tabs (title, URL, pinned/active/audible/incognito status, etc.)
- Sends that list plus your request to Gemini
- Gemini returns a strict JSON array describing which tabs to close
- The extension automatically closes those tabs and shows you what was closed

> **Important**: The extension opens a background Gemini tab and closes it automatically when the response arrives.

## How to use
1. Install the extension locally (load unpacked extension in Chrome/Edge).
2. Click the extension icon to open the popup.
3. Describe what you want removed (e.g. "close all tabs not related to work" or "close tabs I haven’t used in 24 hours").
4. The extension will automatically close matching tabs and show what was closed.

## 🧠 What Gemini sees (in the prompt)
The extension sends Gemini a list of all open tabs including:
- Title + URL
- Whether the tab is pinned, active, audible, discarded, or incognito
- Tab group ID (if any)
- Tab status (loading/complete/unknown)
- Last accessed timestamp

## 🛠️ Files in the project
- `manifest.json` – extension metadata and permissions
- `popup.html` + `popup.js` – UI and tab collection logic
- `background.js` – handles opening Gemini and closing it when done
- `content.js` – injects the prompt into Gemini and scrapes the response
- `icons/` – generated 16/48/128 PNG icons (from `icon.svg`)

## Permissions
The extension requests:
- `tabs` (to read and close tabs)
- `activeTab` (to get current tab info)
- `scripting` (used by content script injection)
- `storage` (to pass data between popup, background, and content scripts)

## Notes
- Gemini must be logged in for the extension to work.
- This is an experimental workflow; Gemini’s interpretation may vary.

---

If you want the extension to stop asking Gemini and instead use a local ruleset (e.g., close tabs older than X hours), I can add that too.