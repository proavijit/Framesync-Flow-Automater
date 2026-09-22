/**
 * Antigravity Flow Automator - Google Flow Content Script (v1.1.0)
 * Handles:
 * - Robust multi-strategy DOM input binding
 * - High-fidelity multi-line prompt text insertion (preserving newlines and character locks)
 * - Automatic reference image slot detection and synthetic File upload via DataTransfer
 * - DOM MutationObserver & hybrid polling for completed AI image generation
 */

(function () {
  if (window.__flowAutomatorInjected) {
    return;
  }
  window.__flowAutomatorInjected = true;

  console.log('[Flow Automator] Content Script active with Multi-Character & Image Reference Support.');

  // Runtime Message Dispatcher
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === 'PING') {
      sendResponse({ status: 'READY', url: window.location.href, title: document.title });
      return false;
    }

    if (message.action === 'GENERATE_PROMPT') {
      handlePromptGeneration(message.payload)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
      return true; // Keep message channel open for asynchronous response
    }

    return false;
  });

  /**
   * Main generation pipeline:
   * 1. Check & upload character reference images (if platform supports image reference slot).
   * 2. Locate prompt input and inject full multi-line prompt text.
   * 3. Snapshot existing rendered image assets.
   * 4. Trigger generation submission.
   * 5. Observe DOM for new high-res render.
   */
  async function handlePromptGeneration({ tag, prompt, referenceImages = [], timeoutMs = 45000 }) {
    console.log(`[Flow Automator] Starting #${tag}. References: ${referenceImages.length} | Prompt Length: ${prompt.length}`);

    // Step 1: Upload Character Reference Images (if any attached and slot exists)
    if (referenceImages && referenceImages.length > 0) {
      await attemptReferenceImageUpload(referenceImages);
    }

    // Step 2: Locate Prompt Input Element
    const inputEl = findPromptInput();
    if (!inputEl) {
      throw new Error('Could not locate Google Flow prompt input field (textarea / contenteditable).');
    }

    // Step 3: Snapshot Existing Image URLs
    const existingImageUrls = getCurrentImageUrls();

    // Step 4: Insert Multi-Line Prompt (preserving character attributes and art direction)
    await insertMultiLinePrompt(inputEl, prompt);
    await delay(400);

    // Step 5: Trigger Submission (Click button or Enter key)
    const submitted = triggerSubmission(inputEl);
    if (!submitted) {
      throw new Error('Failed to dispatch generation submission (neither Generate button nor Enter key succeeded).');
    }

    // Step 6: Await New Image Render via MutationObserver & Polling Fallback
    const assetUrl = await waitForNewRender(existingImageUrls, timeoutMs);
    console.log(`[Flow Automator] Render detected for #${tag}: ${assetUrl.slice(0, 60)}...`);

    return {
      success: true,
      tag: tag,
      imageUrl: assetUrl
    };
  }

  /**
   * Search for file upload slot in Google Flow and attach reference images
   */
  async function attemptReferenceImageUpload(referenceImages) {
    try {
      // Find candidate file inputs
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      let targetInput = null;

      for (const input of fileInputs) {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        if (accept.includes('image') || accept === '*' || !accept) {
          targetInput = input;
          break;
        }
      }

      if (!targetInput) {
        console.log('[Flow Automator] Note: Direct file upload slot not found in Flow DOM. Relying on enriched visual prompt descriptors.');
        return;
      }

      // Convert Data URLs to File objects and populate DataTransfer
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
        console.log(`[Flow Automator] Attached ${dt.files.length} reference image(s) to Flow input slot.`);
        await delay(500);
      }
    } catch (err) {
      console.warn('[Flow Automator] Reference image upload fallback:', err.message);
    }
  }

  /**
   * Multi-strategy heuristic selector for Google Flow prompt input
   */
  function findPromptInput() {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[aria-label*="prompt" i]',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      'input[type="text"][placeholder*="prompt" i]',
      'input[type="text"]'
    ];

    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
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
   * Insert multi-line prompt text cleanly without truncation or loss of newlines
   */
  async function insertMultiLinePrompt(el, text) {
    el.focus();
    await delay(100);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Prototype setter bypass to ensure internal framework state (React, Angular, Lit) updates
      const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
    } else if (el.isContentEditable) {
      el.focus();
      // Clear current content
      document.execCommand('selectAll', false, null);

      // Attempt clean text insertion preserving multi-line breaks
      let insertSuccess = false;
      try {
        insertSuccess = document.execCommand('insertText', false, text);
      } catch (e) {
        insertSuccess = false;
      }

      if (!insertSuccess) {
        // Fallback: Format newlines into HTML paragraphs or break tags for contenteditable
        const formattedHtml = text
          .split('\n')
          .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
          .join('');
        el.innerHTML = formattedHtml;
      }
    }

    // Dispatch full realistic event chain
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
   * Find Generate/Submit button or dispatch Enter keyboard event
   */
  function triggerSubmission(inputEl) {
    const buttonSelectors = [
      'button[aria-label*="generate" i]',
      'button[aria-label*="send" i]',
      'button[aria-label*="submit" i]',
      'button[aria-label*="create" i]',
      'button[title*="generate" i]',
      'button[title*="send" i]',
      'button[type="submit"]',
      'button'
    ];

    for (const selector of buttonSelectors) {
      const buttons = document.querySelectorAll(selector);
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

    // Synthetic Enter key fallback
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

  function getCurrentImageUrls() {
    const urls = new Set();
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (img.src) urls.add(img.src);
      if (img.currentSrc) urls.add(img.currentSrc);
    }
    return urls;
  }

  function waitForNewRender(existingUrls, timeoutMs) {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let observer = null;
      let pollTimer = null;
      let timeoutTimer = null;

      const cleanup = () => {
        isResolved = true;
        if (observer) observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      const checkForNewAsset = () => {
        if (isResolved) return;

        const imgs = Array.from(document.querySelectorAll('img')).reverse();

        for (const img of imgs) {
          const src = img.currentSrc || img.src;
          if (!src || existingUrls.has(src)) continue;

          const width = img.naturalWidth || img.width || img.clientWidth || 0;
          const height = img.naturalHeight || img.height || img.clientHeight || 0;

          const isBlob = src.startsWith('blob:');
          const isData = src.startsWith('data:image/');
          const isHttp = src.startsWith('http://') || src.startsWith('https://');

          if (isBlob || isData || (isHttp && (width >= 120 || height >= 120 || width === 0))) {
            if (img.complete && (img.naturalWidth > 100 || isBlob || isData)) {
              cleanup();
              resolve(src);
              return;
            }
          }
        }

        const canvases = Array.from(document.querySelectorAll('canvas'));
        for (const canvas of canvases) {
          if (canvas.width > 200 && canvas.height > 200) {
            try {
              const dataUrl = canvas.toDataURL('image/png');
              if (dataUrl && dataUrl.length > 500) {
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

      observer = new MutationObserver(() => checkForNewAsset());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'style', 'class']
      });

      pollTimer = setInterval(() => checkForNewAsset(), 700);

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) waiting for AI render to complete.`));
      }, timeoutMs);

      checkForNewAsset();
    });
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
