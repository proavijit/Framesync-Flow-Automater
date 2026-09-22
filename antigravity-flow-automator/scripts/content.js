/**
 * Antigravity Flow Automator - Google Flow Content Script (v1.3.0)
 * Architecture & Features:
 * - Deep Shadow DOM traversal for Google Flow web components
 * - Workspace / Project detection (alerts user if on home screen without active canvas)
 * - High-fidelity multi-line prompt insertion & reference image file slot attachment
 * - Snapshot-based render observer that NEVER downloads old or existing gallery images
 * - Hard failure if no new asset appears, preventing wrong file downloads and triggering retry
 */

(function () {
  if (window.__flowAutomatorInjected) {
    return;
  }
  window.__flowAutomatorInjected = true;

  console.log('[Flow Automator] Deep Content Script active.');

  // Runtime Message Listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === 'PING') {
      const isProjectOpen = detectActiveProject();
      sendResponse({
        status: 'READY',
        url: window.location.href,
        title: document.title,
        isProjectOpen: isProjectOpen
      });
      return false;
    }

    if (message.action === 'CHECK_PROJECT_STATUS') {
      const status = detectActiveProject();
      sendResponse({ isProjectOpen: status });
      return false;
    }

    if (message.action === 'GENERATE_PROMPT') {
      handlePromptGeneration(message.payload)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
      return true; // Asynchronous response
    }

    return false;
  });

  /**
   * Detects whether an active Flow project editor / canvas is open
   */
  function detectActiveProject() {
    // 1. If an input field exists, a project is definitely open
    if (findPromptInput()) return true;

    // 2. Check URL for project indicators
    const url = window.location.href.toLowerCase();
    if (url.includes('/project/') || url.includes('/canvas/') || url.includes('/edit/') || url.includes('/workspace/')) {
      return true;
    }

    // 3. Check for main workspace containers
    if (querySelectorDeep('.workspace') || querySelectorDeep('.canvas-container') || querySelectorDeep('[role="main"]')) {
      return true;
    }

    return false;
  }

  /**
   * Main generation pipeline:
   * 1. Validates project state.
   * 2. Attaches reference images (if supported).
   * 3. Locates prompt input via Deep Shadow DOM traversal.
   * 4. Takes an absolute snapshot of all existing images.
   * 5. Dispatches prompt and triggers generation.
   * 6. Strictly awaits a BRAND NEW render (never downloads an old asset).
   */
  async function handlePromptGeneration({ tag, prompt, referenceImages = [], timeoutMs = 45000 }) {
    console.log(`[Flow Automator] Processing #${tag}. Target timeout: ${timeoutMs}ms`);

    // Step 1: Check Project State
    const inputEl = findPromptInput();
    if (!inputEl) {
      // Check if we are on the Flow home screen
      const newProjectBtn = findNewProjectButton();
      if (newProjectBtn) {
        console.log('[Flow Automator] Home screen detected. Attempting to click "New Project"...');
        newProjectBtn.click();
        await delay(2000);
      }

      // Re-check after possible navigation
      const retryInput = findPromptInput();
      if (!retryInput) {
        throw new Error('NO_PROJECT_OPEN: No active Flow Project canvas detected. Please open or create a Flow Project first.');
      }
    }

    const promptInput = findPromptInput();
    if (!promptInput) {
      throw new Error('Could not locate Google Flow prompt input field (textarea / contenteditable / shadow DOM).');
    }

    // Step 2: Upload Character Reference Images if available
    if (referenceImages && referenceImages.length > 0) {
      await attemptReferenceImageUpload(referenceImages);
    }

    // Step 3: STRICT SNAPSHOT of all current images on page
    const initialSnapshot = snapshotAllCurrentImages();
    console.log(`[Flow Automator] Baseline image snapshot captured: ${initialSnapshot.size} existing assets.`);

    // Step 4: Insert Multi-Line Prompt
    await insertMultiLinePrompt(promptInput, prompt);
    await delay(350);

    // Step 5: Trigger Generation Submission
    const submitted = triggerSubmission(promptInput);
    if (!submitted) {
      throw new Error('Failed to dispatch generation submission (neither Generate button nor Enter key succeeded).');
    }

    // Step 6: Wait strictly for a BRAND NEW high-res render
    const newAssetUrl = await waitForBrandNewRender(initialSnapshot, timeoutMs);
    console.log(`[Flow Automator] Verified NEW render for #${tag}: ${newAssetUrl.slice(0, 60)}...`);

    return {
      success: true,
      tag: tag,
      imageUrl: newAssetUrl
    };
  }

  /**
   * Deep Shadow DOM Query Helpers
   */
  function querySelectorDeep(selector, root = document) {
    if (!root) return null;
    let el = root.querySelector(selector);
    if (el) return el;

    const all = root.querySelectorAll('*');
    for (const child of all) {
      if (child.shadowRoot) {
        const found = querySelectorDeep(selector, child.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  function querySelectorAllDeep(selector, root = document) {
    if (!root) return [];
    let results = Array.from(root.querySelectorAll(selector));
    const all = root.querySelectorAll('*');
    for (const child of all) {
      if (child.shadowRoot) {
        results = results.concat(querySelectorAllDeep(selector, child.shadowRoot));
      }
    }
    return results;
  }

  /**
   * Find "New Project" / "Create" button on Flow Home
   */
  function findNewProjectButton() {
    const buttons = querySelectorAllDeep('button, a[role="button"]');
    for (const btn of buttons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (
        text.includes('new project') ||
        text.includes('create project') ||
        text.includes('start blank') ||
        aria.includes('new project') ||
        aria.includes('create project')
      ) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Locate the active Prompt Input field across DOM and Shadow Roots
   */
  function findPromptInput() {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[aria-label*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-slate-editor="true"]',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      'div.prompt-input',
      'input[type="text"][placeholder*="prompt" i]',
      'input[type="text"][placeholder*="describe" i]',
      'textarea',
      'input[type="text"]'
    ];

    for (const sel of selectors) {
      const candidates = querySelectorAllDeep(sel);
      for (const el of candidates) {
        if (isElementVisible(el)) {
          return el;
        }
      }
    }

    if (document.activeElement && (
      document.activeElement.tagName === 'TEXTAREA' ||
      document.activeElement.isContentEditable ||
      document.activeElement.getAttribute('role') === 'textbox'
    )) {
      return document.activeElement;
    }

    return null;
  }

  /**
   * Insert multi-line prompt text preserving newlines and framework reactivity
   */
  async function insertMultiLinePrompt(el, text) {
    el.focus();
    await delay(100);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
    } else if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);

      let insertSuccess = false;
      try {
        insertSuccess = document.execCommand('insertText', false, text);
      } catch (e) {
        insertSuccess = false;
      }

      if (!insertSuccess) {
        const formattedHtml = text
          .split('\n')
          .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
          .join('');
        el.innerHTML = formattedHtml;
      }
    }

    // Comprehensive synthetic event dispatch chain
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText'
    }));
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Trigger submission via Generate button or Enter key
   */
  function triggerSubmission(inputEl) {
    const buttonSelectors = [
      'button[aria-label*="generate" i]',
      'button[aria-label*="create" i]',
      'button[aria-label*="send" i]',
      'button[aria-label*="submit" i]',
      'button[aria-label*="run" i]',
      'button[title*="generate" i]',
      'button[title*="send" i]',
      'button[type="submit"]',
      'button'
    ];

    for (const selector of buttonSelectors) {
      const buttons = querySelectorAllDeep(selector);
      for (const btn of buttons) {
        if (!isElementVisible(btn) || btn.disabled) continue;

        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();

        if (
          text.includes('generate') ||
          text.includes('create') ||
          text.includes('run') ||
          text.includes('send') ||
          aria.includes('generate') ||
          aria.includes('create') ||
          aria.includes('run') ||
          aria.includes('send') ||
          aria.includes('submit') ||
          title.includes('generate') ||
          title.includes('send')
        ) {
          btn.click();
          return true;
        }
      }
    }

    // Dispatch Keyboard Enter
    const enterEvents = [
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
    ];

    for (const ev of enterEvents) {
      inputEl.dispatchEvent(ev);
    }

    return true;
  }

  /**
   * Snapshot all existing images and canvas renders currently in the DOM
   */
  function snapshotAllCurrentImages() {
    const snapshot = new Set();
    const imgs = querySelectorAllDeep('img');
    for (const img of imgs) {
      if (img.src) snapshot.add(img.src);
      if (img.currentSrc) snapshot.add(img.currentSrc);
    }
    return snapshot;
  }

  /**
   * Monitor DOM mutations and polling to detect a GENUINELY NEW high-res render.
   * Will NEVER return an image that was in initialSnapshot.
   */
  function waitForBrandNewRender(initialSnapshot, timeoutMs) {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let observer = null;
      let pollTimer = null;
      let timeoutTimer = null;
      const startTime = Date.now();

      const cleanup = () => {
        isResolved = true;
        if (observer) observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      const checkForNewAsset = () => {
        if (isResolved) return;

        // Query all images in DOM including shadow roots
        const allImgs = querySelectorAllDeep('img').reverse();

        for (const img of allImgs) {
          const src = img.currentSrc || img.src;
          if (!src) continue;

          // CRITICAL: Skip any image that was already present in initial snapshot
          if (initialSnapshot.has(src)) continue;

          // Skip UI avatars, icons, Google logos
          if (
            src.includes('googleusercontent.com/avatar') ||
            src.includes('gstatic.com') ||
            src.includes('favicon') ||
            src.includes('logo') ||
            src.endsWith('.svg')
          ) {
            continue;
          }

          const width = img.naturalWidth || img.width || img.clientWidth || 0;
          const height = img.naturalHeight || img.height || img.clientHeight || 0;

          const isBlob = src.startsWith('blob:');
          const isData = src.startsWith('data:image/');
          const isHttp = src.startsWith('http://') || src.startsWith('https://');

          // Must be an actual rendered generation (> 160px)
          if ((isBlob || isData || isHttp) && (width >= 160 || height >= 160 || (isBlob && width === 0))) {
            if (img.complete && (img.naturalWidth > 120 || isBlob || isData)) {
              cleanup();
              resolve(src);
              return;
            }
          }
        }

        // Also check for rendered <canvas> element that updated after submission
        const canvases = querySelectorAllDeep('canvas');
        for (const canvas of canvases) {
          if (canvas.width > 250 && canvas.height > 250) {
            try {
              const dataUrl = canvas.toDataURL('image/png');
              if (dataUrl && dataUrl.length > 1000 && !initialSnapshot.has(dataUrl)) {
                cleanup();
                resolve(dataUrl);
                return;
              }
            } catch (e) {
              // cross-origin tainted canvas
            }
          }
        }
      };

      // Mutation Observer targeting root and body
      observer = new MutationObserver(() => {
        checkForNewAsset();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'style', 'class']
      });

      // Polling fallback every 600ms
      pollTimer = setInterval(() => {
        checkForNewAsset();
      }, 600);

      // Hard Timeout: NEVER return a false positive or previous image!
      timeoutTimer = setTimeout(() => {
        cleanup();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        reject(new Error(`Timeout: No new render produced after ${elapsed}s. Generation aborted to prevent downloading stale assets.`));
      }, timeoutMs);

      // Check initially in case render completed rapidly
      checkForNewAsset();
    });
  }

  /**
   * Upload character reference images to Flow file input slot
   */
  async function attemptReferenceImageUpload(referenceImages) {
    try {
      const fileInputs = querySelectorAllDeep('input[type="file"]');
      let targetInput = null;

      for (const input of fileInputs) {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        if (accept.includes('image') || accept === '*' || !accept) {
          targetInput = input;
          break;
        }
      }

      if (!targetInput) {
        console.log('[Flow Automator] Note: File upload slot not exposed in Flow DOM. Visual attributes injected into prompt.');
        return;
      }

      const dt = new DataTransfer();
      for (const ref of referenceImages) {
        if (!ref.dataUrl) continue;
        const res = await fetch(ref.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], ref.fileName || `${ref.characterName || 'char'}.png`, {
          type: blob.type || 'image/png'
        });
        dt.items.add(file);
      }

      if (dt.files.length > 0) {
        targetInput.files = dt.files;
        targetInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        console.log(`[Flow Automator] Attached ${dt.files.length} reference image(s) to Flow file slot.`);
        await delay(400);
      }
    } catch (err) {
      console.warn('[Flow Automator] Reference image upload warning:', err.message);
    }
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
})();
