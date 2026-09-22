/**
 * Antigravity Flow Automator - Background Service Worker (MV3)
 * Orchestrates chrome.downloads pipeline, enforces folder path structure,
 * and sets conflictAction: "overwrite" to eliminate duplicate file artifacts.
 */

console.log('[Flow Automator] Service Worker initialized.');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Flow Automator] Extension installed/updated. Reason:', details.reason);
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
    throw new Error('No URL or image data provided for download.');
  }

  // Sanitize folder and tag to avoid invalid filesystem characters
  const cleanFolder = sanitizePathSegment(folder || 'Default-Flow');
  const cleanTag = sanitizePathSegment(tag || 'unnamed');
  
  // Strict format: [Folder-Name]/[tag].png
  const targetPath = filename && filename.includes('/')
    ? sanitizeFullRelativePath(filename)
    : `${cleanFolder}/${cleanTag}.png`;

  console.log(`[Flow Automator] Triggering download to path: "${targetPath}"`);

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: targetPath,
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

/**
 * Sanitize path components for cross-platform filesystem safety (Windows/macOS/Linux)
 */
function sanitizePathSegment(segment) {
  if (!segment) return 'Default';
  return segment
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // Replace illegal characters with underscore
    .replace(/^\.+/, '') // No leading dots
    .replace(/\.+$/, ''); // No trailing dots
}

function sanitizeFullRelativePath(fullPath) {
  const parts = fullPath.split('/');
  return parts.map(p => sanitizePathSegment(p)).join('/');
}
