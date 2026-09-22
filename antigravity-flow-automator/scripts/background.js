/**
 * Antigravity Flow Automator - Background Service Worker (MV3)
 * Orchestrates:
 * 1. Dedicated Full-Page Dashboard Tab lifecycle (prevents popup auto-closing).
 * 2. chrome.downloads pipeline ensuring [Folder-Name]/[tag].png with overwrite mode.
 */

console.log('[Flow Automator] Background Service Worker initialized.');

// Clicking toolbar icon opens or activates the Dedicated Dashboard Tab
chrome.action.onClicked.addListener(async (activeTab) => {
  const dashboardUrl = chrome.runtime.getURL('popup/popup.html');
  try {
    const existingTabs = await chrome.tabs.query({ url: dashboardUrl });
    if (existingTabs.length > 0) {
      await chrome.tabs.update(existingTabs[0].id, { active: true });
      if (existingTabs[0].windowId) {
        await chrome.windows.update(existingTabs[0].windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url: dashboardUrl });
    }
  } catch (err) {
    console.error('[Flow Automator] Failed to launch dashboard tab:', err);
  }
});

// Runtime Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  if (message.action === 'DOWNLOAD_IMAGE') {
    handleDownload(message.payload)
      .then(downloadId => sendResponse({ success: true, downloadId }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'OPEN_DASHBOARD_TAB') {
    const dashboardUrl = chrome.runtime.getURL('popup/popup.html');
    chrome.tabs.create({ url: dashboardUrl }, (newTab) => {
      sendResponse({ success: true, tabId: newTab.id });
    });
    return true;
  }

  if (message.action === 'PING_SERVICE_WORKER') {
    sendResponse({ status: 'ACTIVE' });
    return false;
  }

  return false;
});

/**
 * Handle asset download pipeline:
 * Enforces folder structure: `[Folder-Name]/[tag].png`
 * Sets conflictAction: "overwrite"
 */
async function handleDownload({ url, folder, tag, filename }) {
  if (!url) {
    throw new Error('No image URL or data provided for download.');
  }

  const cleanFolder = sanitizePathSegment(folder || 'Default-Flow');
  const cleanTag = sanitizePathSegment(tag || 'unnamed');

  // Enforce .png extension strictly
  let cleanName = filename ? sanitizeFullRelativePath(filename) : `${cleanFolder}/${cleanTag}.png`;
  if (!cleanName.toLowerCase().endsWith('.png')) {
    cleanName = cleanName.replace(/\.[^/.]+$/, '') + '.png';
  }

  console.log(`[Flow Automator] Initiating download: "${cleanName}"`);

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: cleanName,
      conflictAction: 'overwrite', // Prevents (1).png duplicates
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Flow Automator] Download failed:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!downloadId) {
        reject(new Error('chrome.downloads.download failed to return a valid download ID.'));
      } else {
        console.log(`[Flow Automator] Download started with ID: ${downloadId}`);
        resolve(downloadId);
      }
    });
  });
}

function sanitizePathSegment(segment) {
  if (!segment) return 'Default';
  return segment
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function sanitizeFullRelativePath(fullPath) {
  const parts = fullPath.split('/');
  return parts.map(p => sanitizePathSegment(p)).join('/');
}
