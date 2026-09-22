/**
 * Antigravity Flow Automator - Background Service Worker (MV3)
 * Orchestrates:
 * 1. Dedicated Full-Page Dashboard Tab lifecycle.
 * 2. Strict Subfolder Pipeline: ${sanitizedFolderName}/${cleanTag}.png
 * 3. Permanent overwrite mode (conflictAction: "overwrite") to guarantee zero duplicate files.
 */

console.log('[Flow Automator] Background Service Worker active.');

// Clicking toolbar icon opens or focuses the Dedicated Dashboard Tab
chrome.action.onClicked.addListener(async () => {
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
    return true;
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
 * - Subfolder Guarantee: strictly formats file path as `${sanitizedFolderName}/${cleanTag}.png`
 * - Permanent overwrite mode (conflictAction: "overwrite") ensures duplicate versions
 *   (like "0-00 (1).png") are NEVER created.
 */
async function handleDownload({ url, folder, tag }) {
  if (!url) {
    throw new Error('No image URL or data provided for download.');
  }

  const sanitizedFolderName = sanitizePathSegment(folder || 'Default-Flow');
  // Strip leading '#' if present on tag and sanitize
  const cleanTag = sanitizePathSegment(tag ? tag.replace(/^#/, '') : 'unnamed');

  // Strict format: ${sanitizedFolderName}/${cleanTag}.png
  const targetPath = `${sanitizedFolderName}/${cleanTag}.png`;

  console.log(`[Flow Automator] Subfolder pipeline triggering: "${targetPath}" [conflictAction: overwrite]`);

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: targetPath,
      conflictAction: 'overwrite', // Permanently prevents duplicates like (1).png
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Flow Automator] Download failed:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!downloadId) {
        reject(new Error('chrome.downloads.download failed to return a valid download ID.'));
      } else {
        console.log(`[Flow Automator] Download initiated successfully [ID: ${downloadId}] -> ${targetPath}`);
        resolve(downloadId);
      }
    });
  });
}

function sanitizePathSegment(segment) {
  if (!segment) return 'Default';
  return segment
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // Replace filesystem forbidden chars
    .replace(/^\.+/, '') // Strip leading dots
    .replace(/\.+$/, ''); // Strip trailing dots
}
