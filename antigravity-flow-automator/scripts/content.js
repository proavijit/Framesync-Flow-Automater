/**
 * Antigravity Flow Automator - Google Flow Content Script (v1.3.1)
 * Critical Fix for Submission:
 * - Exhaustive button locator (send/generate/submit, arrow SVGs, md-icon-button)
 * - Proximity search starting from the input's closest parent form/container
 * - Full synthetic KeyboardEvent dispatch (keydown, keypress, keyup, Enter keyCode 13)
 * - Form requestSubmit fallback
 * - Strict image snapshot observation (never downloads old/gallery assets)
 */

(function () {
  if (window.__flowAutomatorInjected) {
    return;
  }
  window.__flowAutomatorInjected = true;

  console.log('[Flow Automator] Enhanced Content Script active with robust submit triggers.');

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
      return true;
    }

    return false;
  });

  function detectActiveProject() {
    if (findPromptInput()) return true;
    const url = window.location.href.toLowerCase();
    if (url.includes('/project/') || url.includes('/canvas/') || url.includes('/edit/') || url.includes('/workspace/')) {
      return true;
    }
    if (querySelectorDeep('.workspace') || querySelectorDeep('.canvas-container') || querySelectorDeep('[role="main"]')) {
      return true;
    }
    return false;
  }

  async function handlePromptGeneration({ tag, prompt, referenceImages = [], timeoutMs = 45000 }) {
    console.log(`[Flow Automator] Processing #${tag}. Timeout: ${timeoutMs}ms`);

    // Step 1: Ensure input is available
    let promptInput = findPromptInput();
    if (!promptInput) {
      const newProjectBtn = findNewProjectButton();
      if (newProjectBtn) {
        console.log('[Flow Automator] Clicking "New Project"...');
        newProjectBtn.click();
        await delay(2000);
      }
      promptInput = findPromptInput();
      if (!promptInput) {
        throw new Error('NO_PROJECT_OPEN: No active Flow Project canvas detected. Please open or create a Flow Project first.');
      }
    }

    // Step 2: Upload Character Reference Images if attached
    if (referenceImages && referenceImages.length > 0) {
      await attemptReferenceImageUpload(referenceImages);
    }

    // Step 3: Strict image baseline snapshot
    const initialSnapshot = snapshotAllCurrentImages();
    console.log(`[Flow Automator] Snapshot captured: ${initialSnapshot.size} existing assets.`);

    // Step 4: Insert Multi-Line Prompt
    await insertMultiLinePrompt(promptInput, prompt);
    await delay(350);

    // Step 5: Trigger Generation Submission (Buttons + Keyboard Enter Sequence)
    const submitted = triggerRobustSubmission(promptInput);
    if (!submitted) {
      throw new Error('Failed to dispatch generation submission (all submit strategies failed).');
    }
    console.log(`[Flow Automator] Submission dispatched for #${tag}. Awaiting new render...`);

    // Step 6: Await strictly NEW image render
    const newAssetUrl = await waitForBrandNewRender(initialSnapshot, timeoutMs);
    console.log(`[Flow Automator] Detected new render for #${tag}: ${newAssetUrl.slice(0, 60)}...`);

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

    // Comprehensive synthetic events to trigger framework reactive state
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText'
    }));
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('compositionend', { bubbles: true }));
  }

  /**
   * Robust Submit Trigger:
   * 1. Proximity button search (closest prompt container / form / chat bar).
   * 2. Global deep search for submit/send/generate/arrow buttons.
   * 3. Synthetic KeyboardEvent Enter sequence (keydown, keypress, keyup).
   * 4. Form requestSubmit() fallback.
   */
  function triggerRobustSubmission(inputEl) {
    let triggered = false;

    // A. Search in local proximity (closest container, form, or chat panel)
    const container = inputEl.closest('form, div.prompt-bar, div.prompt-container, [role="form"], [class*="prompt" i], [class*="input" i]') || inputEl.parentElement;
    if (container) {
      const localButtons = container.querySelectorAll('button, [role="button"], md-icon-button, mwc-icon-button');
      for (const btn of localButtons) {
        if (!isElementVisible(btn) || btn.disabled) continue;
        if (isSubmitOrGenerateButton(btn)) {
          console.log('[Flow Automator] Clicking local submit button in container:', btn);
          clickButtonSafely(btn);
          triggered = true;
          break;
        }
      }
    }

    // B. Global deep search if not yet triggered
    if (!triggered) {
      const allButtons = querySelectorAllDeep('button, [role="button"], md-icon-button, mwc-icon-button');
      for (const btn of allButtons) {
        if (!isElementVisible(btn) || btn.disabled) continue;
        if (isSubmitOrGenerateButton(btn)) {
          console.log('[Flow Automator] Clicking global submit button:', btn);
          clickButtonSafely(btn);
          triggered = true;
          break;
        }
      }
    }

    // C. Always dispatch full Keyboard Enter Sequence on the input element
    inputEl.focus();
    const eventParams = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false
    };

    inputEl.dispatchEvent(new KeyboardEvent('keydown', eventParams));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', eventParams));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', eventParams));
    console.log('[Flow Automator] Dispatched synthetic Enter key sequence.');

    // D. Form requestSubmit() fallback
    if (inputEl.form) {
      try {
        if (typeof inputEl.form.requestSubmit === 'function') {
          inputEl.form.requestSubmit();
        } else {
          inputEl.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      } catch (err) {
        console.warn('[Flow Automator] form submit error:', err.message);
      }
    }

    return true;
  }

  function isSubmitOrGenerateButton(btn) {
    if (!btn) return false;
    const type = (btn.getAttribute('type') || '').toLowerCase();
    if (type === 'submit') return true;

    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();

    // Check labels
    const matchKeywords = ['generate', 'send', 'submit', 'run', 'create'];
    for (const kw of matchKeywords) {
      if (aria.includes(kw) || title.includes(kw) || text === kw) {
        return true;
      }
    }

    // Check SVG icons inside button (arrow-up, paper plane, send icons)
    const svgs = btn.querySelectorAll('svg');
    if (svgs.length > 0) {
      for (const svg of svgs) {
        const svgAria = (svg.getAttribute('aria-label') || '').toLowerCase();
        if (matchKeywords.some(kw => svgAria.includes(kw))) return true;
        // Buttons containing path or arrow icons near input
        const path = svg.querySelector('path');
        if (path) {
          const d = path.getAttribute('d') || '';
          if (d.length > 10) return true; // Likely a graphic icon like send or arrow
        }
      }
    }

    return false;
  }

  function clickButtonSafely(btn) {
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  }

  function snapshotAllCurrentImages() {
    const snapshot = new Set();
    const imgs = querySelectorAllDeep('img');
    for (const img of imgs) {
      if (img.src) snapshot.add(img.src);
      if (img.currentSrc) snapshot.add(img.currentSrc);
    }
    return snapshot;
  }

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

        const allImgs = querySelectorAllDeep('img').reverse();

        for (const img of allImgs) {
          const src = img.currentSrc || img.src;
          if (!src) continue;

          // Skip any asset in initial snapshot
          if (initialSnapshot.has(src)) continue;

          // Skip avatars, icons, logos
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

          if ((isBlob || isData || isHttp) && (width >= 160 || height >= 160 || (isBlob && width === 0))) {
            if (img.complete && (img.naturalWidth > 120 || isBlob || isData)) {
              cleanup();
              resolve(src);
              return;
            }
          }
        }

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
              // tainted canvas
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

      pollTimer = setInterval(() => checkForNewAsset(), 600);

      timeoutTimer = setTimeout(() => {
        cleanup();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        reject(new Error(`Timeout: No new render produced after ${elapsed}s. Generation aborted to prevent downloading stale assets.`));
      }, timeoutMs);

      checkForNewAsset();
    });
  }

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
