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

    // Step 4: Angular & Native Input Injection
    console.log('[Flow Automator] Injecting prompt via Angular & Native input engine...');
    injectAngularInputValue(promptInput, prompt);
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
   * 1. Angular & Native Input Dispatch
   * Directly triggers browser input engine and Angular Zone / NgModel change detection.
   */
  function injectAngularInputValue(targetInput, promptText) {
    if (!targetInput) return;
    targetInput.focus();
    targetInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    targetInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Select all and use input command to trigger native browser input engine
    if (targetInput.isContentEditable) {
      targetInput.focus();
      document.execCommand('selectAll', false, null);
      let execSuccess = false;
      try {
        execSuccess = document.execCommand('insertText', false, promptText);
      } catch (e) {
        execSuccess = false;
      }
      if (!execSuccess) {
        targetInput.innerHTML = promptText
          .split('\n')
          .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
          .join('');
      }
      targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // For textarea / input
      targetInput.value = promptText;

      // Also ensure native prototype setter is called if overridden
      const prototype = targetInput.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (nativeSetter) {
        try { nativeSetter.call(targetInput, promptText); } catch (e) {}
      }

      // Update valueTracker if present
      if (targetInput._valueTracker) {
        try { targetInput._valueTracker.setValue(promptText); } catch (e) {}
      }

      // Trigger standard Angular input cycle with composed: true for zone check
      targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));
      targetInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
      targetInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    }
  }

  /**
   * Cleanly clear input element on retry or initialization
   */
  function clearInputElement(element) {
    if (!element) return;
    try {
      element.focus();
      if (element.isContentEditable) {
        element.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        element.innerHTML = '';
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      } else {
        element.value = '';
        const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (nativeSetter) {
          try { nativeSetter.call(element, ''); } catch (e) {}
        }
        if (element._valueTracker) {
          try { element._valueTracker.setValue(''); } catch (e) {}
        }
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
      }
    } catch (e) {
      console.warn('[Flow Automator] Clear input warning:', e);
    }
  }

  /**
   * 2. True PointerEvent & MouseEvent Dispatcher
   * Specifically triggers Angular Material host, button, touch target, and mat-icon.
   */
  function dispatchPointerAndClick(el) {
    if (!el) return;

    const targets = new Set();

    // 1. Add element itself
    targets.add(el);

    // 2. Custom Host: <flow-generate-icon-button>
    const host = el.closest('flow-generate-icon-button') || 
                 (el.tagName === 'FLOW-GENERATE-ICON-BUTTON' ? el : null) ||
                 document.querySelector('flow-generate-icon-button');
    if (host) {
      targets.add(host);
      host.querySelectorAll('button, .mat-mdc-button-touch-target, mat-icon, svg, span').forEach(t => targets.add(t));
    }

    // 3. Closest button
    const closestBtn = el.closest('button, [role="button"], md-icon-button, mwc-icon-button') || 
                       (el.tagName === 'BUTTON' ? el : null);
    if (closestBtn) {
      targets.add(closestBtn);
      closestBtn.querySelectorAll('.mat-mdc-button-touch-target, mat-icon, svg, span').forEach(t => targets.add(t));
    }

    // 4. Specifically ensure Angular Material touch target & mat-icon are included
    const touchTarget = el.querySelector?.('.mat-mdc-button-touch-target') || 
                        closestBtn?.querySelector?.('.mat-mdc-button-touch-target') || 
                        host?.querySelector?.('.mat-mdc-button-touch-target');
    if (touchTarget) targets.add(touchTarget);

    const matIcon = el.querySelector?.('mat-icon') || 
                    closestBtn?.querySelector?.('mat-icon') || 
                    host?.querySelector?.('mat-icon');
    if (matIcon) targets.add(matIcon);

    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + (rect.width > 0 ? rect.width / 2 : 10);
      const clientY = rect.top + (rect.height > 0 ? rect.height / 2 : 10);
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        detail: 1
      };

      // Pointer & Mouse Sequence
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
   * Dispatches Angular Form Submission via Enter key sequence, native form.requestSubmit(), and pointer click.
   */
  async function triggerFlowSubmitAction(targetInput, maxWaitMs = 10000) {
    const startTime = Date.now();
    let buttonElement = null;

    // Poll for button to become enabled if it exists
    while (Date.now() - startTime < maxWaitMs) {
      buttonElement = findGoogleFlowSubmitButton(targetInput);

      if (buttonElement) {
        const isDisabled = buttonElement.disabled ||
          buttonElement.getAttribute('aria-disabled') === 'true' ||
          buttonElement.classList.contains('disabled');

        if (!isDisabled) {
          break;
        } else {
          console.log('[Flow Automator] Submit button found in drawer but disabled. Waiting for Angular state...');
        }
      }

      await delay(500);
    }

    // 1. Target the enclosing <form> directly
    let form = targetInput.closest('form') || targetInput.form;
    if (!form) {
      try {
        form = document.querySelector('form:has(flow-generate-icon-button)') ||
               document.querySelector('form:has(button[aria-label*="generation" i])');
      } catch (e) {
        form = document.querySelector('form');
      }
    }
    if (!form) {
      const drawer = targetInput.closest('[role="complementary"]') || 
                     targetInput.closest('aside') || 
                     targetInput.closest('.session-container');
      if (drawer) form = drawer.querySelector('form');
    }

    const submitBtn = buttonElement || 
                      (form ? form.querySelector('button[type="submit"]') : null) || 
                      document.querySelector('button[aria-label*="Start generation" i]') ||
                      document.querySelector('flow-generate-icon-button button');

    console.log("[Flow Automator] Executing Angular Form submission sequence...");

    // Step A: Focus input
    targetInput.focus();
    await delay(50);

    // Step B: Dispatch Enter key with keydown, keypress, keyup directly on targetInput
    const enterOptions = { 
      key: 'Enter', 
      code: 'Enter', 
      keyCode: 13, 
      which: 13, 
      charCode: 13,
      bubbles: true, 
      cancelable: true,
      composed: true
    };
    targetInput.dispatchEvent(new KeyboardEvent('keydown', enterOptions));
    targetInput.dispatchEvent(new KeyboardEvent('keypress', enterOptions));
    targetInput.dispatchEvent(new KeyboardEvent('keyup', enterOptions));

    // Step C: Trigger native requestSubmit on the form
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit(submitBtn || undefined);
        console.log("[Flow Automator] Dispatched form.requestSubmit() successfully.");
      } catch (err) {
        console.warn("[Flow Automator] form.requestSubmit failed, falling back to button click", err);
        if (submitBtn) {
          try { submitBtn.click(); } catch (e) {}
        }
      }
    } else if (submitBtn) {
      try { submitBtn.click(); } catch (e) {}
    }

    // Step D: Also dispatch full pointer & click sequence on submit button & touch target
    if (submitBtn) {
      console.log("[Flow Automator] Found and clicked submit button:", submitBtn);
      dispatchPointerAndClick(submitBtn);
    }

    await delay(400);
    return true;
  }

  /**
   * Exclude header, navigation, and Google Account profile elements
   */
  function isExcludedHeaderElement(el) {
    if (!el) return true;

    // Reject header, nav, or Google Account wrappers
    if (el.closest('header, nav, [role="banner"], [role="navigation"], .gb_C, [class*="gb_"], [href*="SignOutOptions"]')) {
      return true;
    }

    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const href = (el.getAttribute('href') || '').toLowerCase();
    const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();

    const forbidden = [
      'google account',
      'account',
      'sign in',
      'sign out',
      'profile',
      'avatar',
      'notifications',
      'google apps',
      'help',
      'feedback',
      'menu',
      'settings'
    ];

    for (const term of forbidden) {
      if (aria.includes(term) || title.includes(term) || href.includes(term) || className.includes(term)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Specifically targets the submit button in the Right-Hand Flow Drawer / Chat Panel.
   * Scoped to the drawer/session container and searches for the bottom-right circular arrow button.
   */
  function findGoogleFlowSubmitButton(inputEl) {
    if (!inputEl) return null;

    const inputRect = inputEl.getBoundingClientRect();

    // 1. Locate the Right-Hand Flow Drawer / Chat Panel / Session Container
    const drawer = inputEl.closest('[role="complementary"]') || 
                   inputEl.closest('aside') || 
                   inputEl.closest('.session-container') ||
                   inputEl.closest('div[class*="drawer" i]') ||
                   inputEl.closest('div[class*="panel" i]') ||
                   inputEl.closest('div[class*="sidebar" i]') ||
                   inputEl.closest('div[class*="chat" i]') ||
                   inputEl.closest('form') ||
                   inputEl.parentElement?.parentElement?.parentElement?.parentElement ||
                   document.body;

    // Priority 1: Exact <flow-generate-icon-button> host element
    const hostEl = drawer.querySelector('flow-generate-icon-button') || 
                   document.querySelector('flow-generate-icon-button');
    if (hostEl && isElementVisible(hostEl)) {
      const btn = hostEl.querySelector('button') || hostEl;
      if (!isExcludedHeaderElement(btn)) {
        return btn;
      }
    }

    // Priority 2: Direct Angular Material Google Flow submit button match
    const angularMatches = Array.from(drawer.querySelectorAll(
      'flow-generate-icon-button button, button[aria-label*="Start generation" i], button.generate-icon-button, button[flow-icon-button], button[maticonbutton][type="submit"]'
    ));
    for (const btn of angularMatches) {
      if (!isExcludedHeaderElement(btn) && isElementVisible(btn)) {
        return btn;
      }
    }

    // Priority 3: Inner mat-icon with 'arrow_forward'
    const matIcons = Array.from(drawer.querySelectorAll('mat-icon'));
    for (const mi of matIcons) {
      if ((mi.innerText || mi.textContent || '').trim().includes('arrow_forward')) {
        const parentBtn = mi.closest('button, [role="button"], flow-generate-icon-button');
        if (parentBtn && !isExcludedHeaderElement(parentBtn) && isElementVisible(parentBtn)) {
          return parentBtn;
        }
      }
    }

    // 2. Query candidate buttons within or below the input in the drawer
    const candidateElements = Array.from(drawer.querySelectorAll(
      'button, div[role="button"], md-icon-button, mwc-icon-button, flow-generate-icon-button'
    ));

    const candidates = candidateElements.filter(btn => {
      if (isExcludedHeaderElement(btn)) return false;
      const rect = btn.getBoundingClientRect();
      // Must be visible and located below or near the top of the input field
      return rect.width > 0 && rect.height > 0 && rect.top >= inputRect.top - 25;
    });

    // 3. Filter for buttons containing an SVG (like the circular arrow icon) or action keywords
    const validButtons = candidates.filter(btn => {
      const hasSvg = btn.querySelector('svg') !== null;
      const hasMatIcon = btn.querySelector('mat-icon') !== null;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const type = (btn.getAttribute('type') || '').toLowerCase();
      const className = (typeof btn.className === 'string' ? btn.className : '').toLowerCase();

      return type === 'submit' ||
        btn.tagName === 'FLOW-GENERATE-ICON-BUTTON' ||
        btn.hasAttribute('flow-icon-button') ||
        btn.hasAttribute('maticonbutton') ||
        className.includes('generate') ||
        aria.includes('start generation') ||
        aria.includes('generation') ||
        hasSvg ||
        hasMatIcon ||
        aria.includes('send') ||
        aria.includes('run') ||
        aria.includes('generate') ||
        aria.includes('submit') ||
        title.includes('send') ||
        title.includes('generate') ||
        title.includes('run');
    });

    if (validButtons.length > 0) {
      // Prioritize explicit generate / submit buttons
      const priorityBtn = validButtons.find(b => 
        (b.getAttribute('aria-label') || '').toLowerCase().includes('start generation') ||
        (typeof b.className === 'string' && b.className.includes('generate')) ||
        b.hasAttribute('flow-icon-button') ||
        b.tagName === 'FLOW-GENERATE-ICON-BUTTON'
      );
      if (priorityBtn) return priorityBtn;

      // Pick the last enabled/interactive one located at the bottom-right coordinates
      validButtons.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        return (rA.right + rA.bottom) - (rB.right + rB.bottom);
      });
      return validButtons[validButtons.length - 1];
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
