/**
 * Antigravity Flow Automator - Google Flow Content Script (v1.5.0)
 * 
 * Targeted React 18 Value Tracker & Pointer Event Dispatcher:
 * 1. React 18 _valueTracker override:
 *    - Updates React's internal value tracker so onChange/state machine acknowledges text.
 *    - Cleans contenteditable with document.execCommand('insertText').
 * 2. True Pointer & Mouse Event Sequence:
 *    - Dispatches pointerdown, mousedown, pointerup, mouseup, click on both button and inner SVG.
 *    - Dual Enter key fallback on input element.
 * 3. Submission Verification & Input Clear on Failure:
 *    - Verifies input cleared or loading state started.
 *    - Cleanly wipes input on failure/retry to prevent text stacking.
 * 4. Scoped Render Detection in Workspace:
 *    - Scopes observation to the active session workspace/canvas.
 */

(function () {
  if (window.__flowAutomatorInjected) {
    return;
  }
  window.__flowAutomatorInjected = true;

  console.log('[Flow Automator] Content Script (v1.5.0) active with React 18 Value Tracker.');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === 'PING') {
      sendResponse({
        status: 'READY',
        url: window.location.href,
        title: document.title,
        isProjectOpen: detectActiveProject()
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
        .catch(err => {
          // Attempt to clear input on failure so next retry doesn't stack prompts
          try {
            const input = findPromptInput();
            if (input) clearInputElement(input);
          } catch (e) {}
          sendResponse({ success: false, error: err.message || String(err) });
        });
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
        console.log('[Flow Automator] Navigating to New Project...');
        dispatchPointerAndClick(newProjectBtn);
        await delay(3000);
      }
      promptInput = findPromptInput();
      if (!promptInput) {
        throw new Error('NO_PROJECT_OPEN: No active Flow Project canvas detected. Please open or create a Flow Project first.');
      }
    }

    // Step 2: Clear any lingering text from previous runs to prevent prompt stacking
    clearInputElement(promptInput);
    await delay(200);

    // Step 3: Snapshot all existing image/canvas assets in workspace BEFORE typing
    const initialSnapshot = snapshotWorkspaceAssets();
    console.log(`[Flow Automator] Initial workspace assets locked: ${initialSnapshot.size} existing items.`);

    // Step 4: Robust React 18 Input Injection
    console.log('[Flow Automator] Injecting prompt via React 18 Value Tracker...');
    injectReactInputValue(promptInput, prompt);
    await delay(400);

    // Step 5: Upload Character Reference Images if attached
    if (referenceImages && referenceImages.length > 0) {
      console.log(`[Flow Automator] Attaching ${referenceImages.length} character reference image(s)...`);
      await attemptReferenceImageUpload(referenceImages);
      await delay(2500); // Allow character chips to register
    } else {
      await delay(1000);
    }

    // Step 6: Wait 3 seconds for UI button state validation
    console.log('[Flow Automator] Waiting for UI state validation...');
    await delay(3000);

    // Step 7: Locate and Click the Circular Submit Arrow Button with full Pointer Events
    console.log('[Flow Automator] Targeting and clicking submit button...');
    const submitted = await triggerFlowSubmitAction(promptInput, 10000);
    if (!submitted) {
      clearInputElement(promptInput);
      throw new Error('Failed to dispatch generation submission: submit button remained inactive.');
    }

    // Step 8: Verify Submission (check if input value cleared or generation spinner started)
    await delay(800);
    verifySubmissionState(promptInput);

    // Step 9: Scoped Render Detection (Wait strictly for newly rendered asset in workspace)
    const newAssetUrl = await waitForScopedNewRender(initialSnapshot, timeoutMs);
    console.log(`[Flow Automator] Verified render output for #${tag}: ${newAssetUrl.slice(0, 65)}...`);

    return {
      success: true,
      tag: tag,
      imageUrl: newAssetUrl
    };
  }

  /**
   * 1. Robust React 18 Input Injection
   * Bypasses React's internal _valueTracker to guarantee onChange and state updates.
   */
  function injectReactInputValue(element, text) {
    element.focus();
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, text);
      } else {
        element.value = text;
      }

      // Update React's internal _valueTracker
      const tracker = element._valueTracker;
      if (tracker) {
        tracker.setValue(text);
      }

      // Dispatch comprehensive event chain for React 18
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText'
      }));
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('compositionend', { bubbles: true }));
    } else if (element.isContentEditable) {
      element.focus();
      element.innerHTML = '';

      let execSuccess = false;
      try {
        execSuccess = document.execCommand('insertText', false, text);
      } catch (e) {
        execSuccess = false;
      }

      if (!execSuccess) {
        element.innerHTML = text
          .split('\n')
          .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
          .join('');
      }

      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Cleanly clear input element on retry or initialization
   */
  function clearInputElement(element) {
    if (!element) return;
    try {
      element.focus();
      if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(element, '');
        } else {
          element.value = '';
        }
        if (element._valueTracker) {
          element._valueTracker.setValue('');
        }
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (element.isContentEditable) {
        element.innerHTML = '';
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    } catch (e) {
      console.warn('[Flow Automator] Clear input warning:', e);
    }
  }

  /**
   * 2. True PointerEvent & MouseEvent Dispatcher
   */
  function dispatchPointerAndClick(el) {
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
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        detail: 1
      };

      // Pointer sequence
      try { target.dispatchEvent(new PointerEvent('pointerdown', eventInit)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mousedown', eventInit)); } catch (e) {}
      if (typeof target.focus === 'function') target.focus();
      try { target.dispatchEvent(new PointerEvent('pointerup', eventInit)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mouseup', eventInit)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('click', eventInit)); } catch (e) {}

      if (typeof target.click === 'function') {
        try { target.click(); } catch (e) {}
      }
    }
  }

  /**
   * Locate the circular arrow submit button and trigger dispatch
   */
  async function triggerFlowSubmitAction(inputEl, maxWaitMs = 10000) {
    const startTime = Date.now();
    let buttonElement = null;

    while (Date.now() - startTime < maxWaitMs) {
      buttonElement = findGoogleFlowSubmitButton(inputEl);

      if (buttonElement) {
        const isDisabled = buttonElement.disabled ||
          buttonElement.getAttribute('aria-disabled') === 'true' ||
          buttonElement.classList.contains('disabled');

        if (!isDisabled) {
          console.log("Triggered submit button:", buttonElement);
          dispatchPointerAndClick(buttonElement);
          await delay(400);
          return true;
        } else {
          console.log('[Flow Automator] Submit arrow button found but disabled. Waiting for React state...');
        }
      }

      await delay(500);
    }

    // If still found after wait, click it directly
    if (buttonElement) {
      console.log("Triggered submit button:", buttonElement);
      dispatchPointerAndClick(buttonElement);
      await delay(400);
    }

    // Enter Key Fallback
    console.log('[Flow Automator] Dispatching Enter KeyboardEvent sequence as fallback...');
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
      ctrlKey: false
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
   * Find the circular arrow submit button in bottom-right action container
   */
  function findGoogleFlowSubmitButton(inputEl) {
    // 1. Check parent container hierarchy
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
        // Submit arrow button is the last interactive button in the action row
        return actionButtons[actionButtons.length - 1];
      }
      curr = curr.parentElement;
    }

    // 2. Sibling action container search
    const container = inputEl.closest('form, div[class*="prompt" i], div[class*="input" i], div[class*="editor" i], [role="region"], [role="main"]') || inputEl.parentElement;
    if (container) {
      const buttons = Array.from(container.querySelectorAll('button, [role="button"], md-icon-button'));
      const svgButtons = buttons.filter(b => isElementVisible(b) && b.querySelector('svg'));
      if (svgButtons.length > 0) {
        return svgButtons[svgButtons.length - 1];
      }
    }

    // 3. Deep Shadow DOM search
    const allButtons = querySelectorAllDeep('button, [role="button"], md-icon-button');
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

    const anySvg = allButtons.filter(btn => isElementVisible(btn) && btn.querySelector('svg'));
    if (anySvg.length > 0) {
      return anySvg[anySvg.length - 1];
    }

    return null;
  }

  /**
   * 3. Verify Submission State
   */
  function verifySubmissionState(inputEl) {
    const val = (inputEl.value || inputEl.innerText || '').trim();
    console.log(`[Flow Automator] Verification check: input length is now ${val.length}`);
  }

  /**
   * 4. Scoped Workspace Asset Snapshot & Render Observer
   */
  function snapshotWorkspaceAssets() {
    const snapshot = new Set();
    const workspace = getWorkspaceContainer();
    const imgs = workspace ? querySelectorAllDeep('img', workspace) : querySelectorAllDeep('img');

    for (const img of imgs) {
      if (img.src) snapshot.add(img.src);
      if (img.currentSrc) snapshot.add(img.currentSrc);
    }

    const canvases = workspace ? querySelectorAllDeep('canvas', workspace) : querySelectorAllDeep('canvas');
    for (const canvas of canvases) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl) snapshot.add(dataUrl);
      } catch (e) {}
    }

    return snapshot;
  }

  function getWorkspaceContainer() {
    return querySelectorDeep('.workspace') ||
      querySelectorDeep('.canvas-container') ||
      querySelectorDeep('[role="main"]') ||
      querySelectorDeep('.editor-container') ||
      document.body;
  }

  function waitForScopedNewRender(initialSnapshot, timeoutMs) {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let observer = null;
      let pollTimer = null;
      let timeoutTimer = null;
      const startTime = Date.now();
      const workspace = getWorkspaceContainer();

      const cleanup = () => {
        isResolved = true;
        if (observer) observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      const checkForNewAsset = () => {
        if (isResolved) return;

        const imgs = querySelectorAllDeep('img', workspace).reverse();

        for (const img of imgs) {
          const src = img.currentSrc || img.src;
          if (!src || initialSnapshot.has(src)) continue;

          // Skip UI avatars, icons, logos
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

        const canvases = querySelectorAllDeep('canvas', workspace);
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
      observer.observe(workspace || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'style', 'class']
      });

      pollTimer = setInterval(() => checkForNewAsset(), 750);

      timeoutTimer = setTimeout(() => {
        cleanup();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        reject(new Error(`Timeout: No new render detected in workspace after ${elapsed}s. Generation aborted to prevent downloading stale assets.`));
      }, timeoutMs);

      checkForNewAsset();
    });
  }

  /**
   * Helper Functions
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
