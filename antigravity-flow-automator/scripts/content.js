/**
 * Antigravity Flow Automator - Google Flow Content Script (v1.4.1)
 * 
 * Critical Fix for Google Flow Submit Arrow Button:
 * 1. Targeted Bottom-Right Submit Button Selector:
 *    - Proximity search starting from active prompt container.
 *    - Finds the last enabled interactive button with an SVG/arrow icon or send/run/generate labels.
 * 2. True Mouse Event Sequence:
 *    - Dispatches pointerdown, mousedown, pointerup, mouseup, click with full bubbling & view: window.
 *    - Dispatches both on target element and closest('button').
 * 3. Visual Verification Log:
 *    - console.log("Triggered submit button:", buttonElement);
 * 4. Human-like Pacing & 90s Render Timeout.
 */

(function () {
  if (window.__flowAutomatorInjected) {
    return;
  }
  window.__flowAutomatorInjected = true;

  console.log('[Flow Automator] Content Script (v1.4.1) active with Arrow Submit Button targeting.');

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
      sendResponse({ isProjectOpen: detectActiveProject() });
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

  async function handlePromptGeneration({ tag, prompt, referenceImages = [], timeoutMs = 90000 }) {
    console.log(`[Flow Automator] === Starting Job #${tag} [Timeout: ${Math.round(timeoutMs / 1000)}s] ===`);

    // Step 1: Ensure active project canvas & input field are ready
    let promptInput = findPromptInput();
    if (!promptInput) {
      const newProjectBtn = findNewProjectButton();
      if (newProjectBtn) {
        console.log('[Flow Automator] Home screen detected. Navigating to New Project...');
        triggerClick(newProjectBtn);
        await delay(3000);
      }
      promptInput = findPromptInput();
      if (!promptInput) {
        throw new Error('NO_PROJECT_OPEN: No active Flow Project canvas detected. Please open or create a Flow Project first.');
      }
    }

    // Step 2: Snapshot all existing image/canvas assets BEFORE typing begins
    const initialSnapshot = snapshotAllCurrentImages();
    console.log(`[Flow Automator] Initial asset snapshot locked: ${initialSnapshot.size} existing items.`);

    // Step 3: Human-like Chunked Typing into Prompt Field
    console.log('[Flow Automator] Step 1 & 2: Focusing and typing prompt with realistic pacing...');
    await humanLikeTyping(promptInput, prompt);

    // Step 4: Handle Character References & Portrait Uploads
    const hasCharacters = (referenceImages && referenceImages.length > 0) || /man\s*0\d|julian|character/i.test(prompt);
    if (referenceImages && referenceImages.length > 0) {
      console.log(`[Flow Automator] Step 3: Attaching ${referenceImages.length} character reference image(s)...`);
      await attemptReferenceImageUpload(referenceImages);
    }

    if (hasCharacters) {
      console.log('[Flow Automator] Character references detected. Pausing 3 seconds for DOM/chip registration...');
      await delay(3000);
    } else {
      await delay(1200);
    }

    // Step 5: Input Stabilization Pause (3-5s) before submission
    console.log('[Flow Automator] Step 4: Waiting 4 seconds for UI state stabilization and button activation...');
    await delay(4000);

    // Step 6: Target and Trigger the Google Flow Submit Arrow Button
    console.log('[Flow Automator] Step 5: Targeting and triggering submit button...');
    const submitted = await triggerFlowSubmitAction(promptInput, 10000);
    if (!submitted) {
      throw new Error('Failed to dispatch generation submission after button targeting and Enter key sequence.');
    }

    // Step 7: Await Brand New Render within Extended Window (90s)
    const newAssetUrl = await waitForBrandNewRender(initialSnapshot, timeoutMs);
    console.log(`[Flow Automator] Render confirmed for #${tag}: ${newAssetUrl.slice(0, 65)}...`);

    return {
      success: true,
      tag: tag,
      imageUrl: newAssetUrl
    };
  }

  /**
   * Human-Like Natural Typing Simulation
   */
  async function humanLikeTyping(el, fullText) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await delay(300);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setElementValue(el, '');
    } else if (el.isContentEditable) {
      el.innerHTML = '';
    }

    const chunkSize = 25;
    let accumulated = '';

    for (let i = 0; i < fullText.length; i += chunkSize) {
      const slice = fullText.slice(i, i + chunkSize);
      accumulated += slice;

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        setElementValue(el, accumulated);
      } else if (el.isContentEditable) {
        el.innerHTML = accumulated
          .split('\n')
          .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
          .join('');
      }

      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: slice,
        inputType: 'insertText'
      }));
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await delay(45);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('compositionend', { bubbles: true }));
    await delay(200);
  }

  function setElementValue(el, val) {
    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, val);
    } else {
      el.value = val;
    }
  }

  /**
   * True Mouse Event Sequence:
   * Dispatches pointerdown, mousedown, pointerup, mouseup, and click
   * with full event bubbling and view: window.
   */
  function triggerClick(el) {
    if (!el) return;

    const targets = new Set([el]);
    const closestBtn = el.closest('button, [role="button"], md-icon-button, mwc-icon-button');
    if (closestBtn) targets.add(closestBtn);

    const innerSvg = el.querySelector('svg');
    if (innerSvg) targets.add(innerSvg);

    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
        try {
          target.dispatchEvent(new MouseEvent(evtType, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: clientX,
            clientY: clientY,
            detail: 1
          }));
        } catch (e) {
          target.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
        }
      });

      if (typeof target.click === 'function') {
        try { target.click(); } catch (err) {}
      }
    }
  }

  /**
   * Specifically targets the Google Flow bottom-right Submit / Arrow button
   * and triggers the full event sequence.
   */
  async function triggerFlowSubmitAction(inputEl, maxWaitMs = 10000) {
    const startTime = Date.now();
    let buttonElement = null;

    // Poll until an active button is found or timeout expires
    while (Date.now() - startTime < maxWaitMs) {
      buttonElement = findGoogleFlowSubmitButton(inputEl);

      if (buttonElement) {
        const isDisabled = buttonElement.disabled ||
          buttonElement.getAttribute('aria-disabled') === 'true' ||
          buttonElement.classList.contains('disabled');

        if (!isDisabled) {
          console.log("Triggered submit button:", buttonElement);
          triggerClick(buttonElement);
          await delay(400);
          return true;
        } else {
          console.log('[Flow Automator] Submit arrow button is present but currently disabled. Waiting...');
        }
      }

      await delay(500);
    }

    // If button was found even if still flagged, trigger click on it
    if (buttonElement) {
      console.log("Triggered submit button:", buttonElement);
      triggerClick(buttonElement);
      await delay(400);
    }

    // Complementary Fallback: Dispatch Enter Key Sequence directly on input
    console.log('[Flow Automator] Dispatching Enter KeyboardEvent sequence on prompt input...');
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

    if (inputEl.form) {
      try {
        if (typeof inputEl.form.requestSubmit === 'function') {
          inputEl.form.requestSubmit();
        }
      } catch (e) {}
    }

    await delay(300);
    return true;
  }

  /**
   * Specific Submit Button Locator:
   * 1. Inspects the parent container and sibling action-bar of the prompt box.
   * 2. Searches for buttons containing an SVG (like the circular arrow icon) or matching aria labels.
   * 3. Selects the last enabled interactive button in that bottom-right container.
   */
  function findGoogleFlowSubmitButton(inputEl) {
    // Strategy 1: Ascend container hierarchy (parent, grandparent, great-grandparent)
    let curr = inputEl;
    for (let depth = 0; depth < 5 && curr && curr !== document.body; depth++) {
      const candidates = Array.from(curr.querySelectorAll(
        'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), md-icon-button:not([disabled]), mwc-icon-button:not([disabled])'
      ));

      const actionButtons = candidates.filter(btn => {
        if (!isElementVisible(btn)) return false;
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const hasSvg = btn.querySelector('svg') !== null;
        return hasSvg ||
          aria.includes('run') ||
          aria.includes('send') ||
          aria.includes('generate') ||
          aria.includes('submit') ||
          aria.includes('create');
      });

      if (actionButtons.length > 0) {
        // In the bottom-right prompt controls, the submit arrow button is the LAST button in the action row
        const targetBtn = actionButtons[actionButtons.length - 1];
        return targetBtn;
      }
      curr = curr.parentElement;
    }

    // Strategy 2: Check closest prompt bar or form container
    const container = inputEl.closest('form, div[class*="prompt" i], div[class*="input" i], div[class*="editor" i], [role="region"], [role="main"]') || inputEl.parentElement;
    if (container) {
      const buttons = Array.from(container.querySelectorAll('button:not([disabled]), [role="button"]:not([aria-disabled="true"])'));
      const svgButtons = buttons.filter(b => isElementVisible(b) && b.querySelector('svg'));
      if (svgButtons.length > 0) {
        return svgButtons[svgButtons.length - 1];
      }
    }

    // Strategy 3: Global Deep Shadow DOM search for buttons containing SVGs or action keywords
    const allButtons = querySelectorAllDeep('button:not([disabled]), [role="button"]:not([aria-disabled="true"])');
    const matching = allButtons.filter(btn => {
      if (!isElementVisible(btn)) return false;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const hasSvg = btn.querySelector('svg') !== null;
      return aria.includes('run') ||
        aria.includes('send') ||
        aria.includes('generate') ||
        aria.includes('submit') ||
        title.includes('generate') ||
        title.includes('send') ||
        (hasSvg && (aria.includes('arrow') || aria.includes('icon')));
    });

    if (matching.length > 0) {
      return matching[matching.length - 1];
    }

    // Fallback: any visible button containing an SVG
    const anySvg = allButtons.filter(btn => isElementVisible(btn) && btn.querySelector('svg'));
    if (anySvg.length > 0) {
      return anySvg[anySvg.length - 1];
    }

    return null;
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

  function snapshotAllCurrentImages() {
    const snapshot = new Set();
    const imgs = querySelectorAllDeep('img');
    for (const img of imgs) {
      if (img.src) snapshot.add(img.src);
      if (img.currentSrc) snapshot.add(img.currentSrc);
    }
    const canvases = querySelectorAllDeep('canvas');
    for (const canvas of canvases) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl) snapshot.add(dataUrl);
      } catch (e) {}
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

          if (initialSnapshot.has(src)) continue;

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
          if (canvas.width >= 250 && canvas.height >= 250) {
            try {
              const dataUrl = canvas.toDataURL('image/png');
              if (dataUrl && dataUrl.length > 2000 && !initialSnapshot.has(dataUrl)) {
                cleanup();
                resolve(dataUrl);
                return;
              }
            } catch (e) {}
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

      pollTimer = setInterval(() => checkForNewAsset(), 750);

      timeoutTimer = setTimeout(() => {
        cleanup();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        reject(new Error(`Timeout: No new render detected after ${elapsed}s. Generation aborted to prevent downloading stale assets.`));
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
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`[Flow Automator] Attached ${dt.files.length} reference image(s) to Flow file slot.`);
        await delay(500);
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
