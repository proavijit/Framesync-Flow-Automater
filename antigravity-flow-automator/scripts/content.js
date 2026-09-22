/**
 * Antigravity Flow Automator - Google Flow Content Script (v1.4.0)
 * 
 * Major Architectural Overhaul:
 * 1. Step-by-Step Human Pacing:
 *    - Chunked natural typing simulation with beforeinput/input events.
 *    - 2-3s delay for character reference portrait registration.
 *    - 3-5s pre-submission stabilization pause.
 * 2. Robust Active Button Waiting:
 *    - Polls up to 10s if the Generate/Send button is disabled.
 *    - Realistic pointer/mouse sequence dispatch.
 *    - Safe Enter key fallback only after full input stabilization.
 * 3. Extended 90s Render Timeout & Smart Canvas Observation:
 *    - 90s window for high-end 16:9 comic/illustration AI rendering.
 *    - Strict snapshot filtering: NEVER returns old/gallery images.
 */

(function () {
  if (window.__flowAutomatorInjected) {
    return;
  }
  window.__flowAutomatorInjected = true;

  console.log('[Flow Automator] Human-Paced Content Script (v1.4.0) initialized.');

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
      return true; // Asynchronous response channel
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

  /**
   * Main generation pipeline with realistic human-like pacing
   */
  async function handlePromptGeneration({ tag, prompt, referenceImages = [], timeoutMs = 90000 }) {
    console.log(`[Flow Automator] === Starting Job #${tag} [Timeout: ${Math.round(timeoutMs / 1000)}s] ===`);

    // Step 1: Ensure active project canvas & input field are ready
    let promptInput = findPromptInput();
    if (!promptInput) {
      const newProjectBtn = findNewProjectButton();
      if (newProjectBtn) {
        console.log('[Flow Automator] Home screen detected. Navigating to New Project...');
        clickElementNaturally(newProjectBtn);
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
      await delay(3000); // 2-3s pause for character chips and state to register
    } else {
      await delay(1200);
    }

    // Step 5: Input Stabilization Pause (3-5s) before submission
    console.log('[Flow Automator] Step 4: Waiting 4 seconds for UI state stabilization and button activation...');
    await delay(4000);

    // Step 6: Robust Active Button Waiting & Click Simulation
    console.log('[Flow Automator] Step 5: Dispatching generation submission...');
    const submitted = await triggerRobustActiveSubmission(promptInput, 10000);
    if (!submitted) {
      throw new Error('Failed to dispatch generation submission after 10s of button polling and Enter key dispatch.');
    }
    console.log(`[Flow Automator] Submission sent successfully for #${tag}. Listening for new render...`);

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
   * Types the text in small progressive chunks with realistic intervals.
   */
  async function humanLikeTyping(el, fullText) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await delay(300);

    // Clear previous text if any
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setElementValue(el, '');
    } else if (el.isContentEditable) {
      el.innerHTML = '';
    }

    // Break text into natural chunks (15-30 characters per slice)
    const chunkSize = 25;
    let accumulated = '';

    for (let i = 0; i < fullText.length; i += chunkSize) {
      const slice = fullText.slice(i, i + chunkSize);
      accumulated += slice;

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        setElementValue(el, accumulated);
      } else if (el.isContentEditable) {
        // Render newlines as divs/br for contenteditable
        el.innerHTML = accumulated
          .split('\n')
          .map(line => line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')
          .join('');
      }

      // Dispatch realistic input events for every slice
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: slice,
        inputType: 'insertText'
      }));
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

      // Natural typing delay (35ms - 75ms per chunk)
      await delay(45);
    }

    // Final stabilization events
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
   * Robust Active Submit Trigger:
   * Polls up to maxWaitMs (10s) if the Generate button is disabled,
   * then executes real pointer/mouse sequence, with Enter key fallback.
   */
  async function triggerRobustActiveSubmission(inputEl, maxWaitMs = 10000) {
    const startTime = Date.now();
    let targetButton = null;

    // Search for button in local proximity first, then globally
    while (Date.now() - startTime < maxWaitMs) {
      targetButton = findGenerateButton(inputEl);

      if (targetButton) {
        const isDisabled = targetButton.disabled ||
          targetButton.getAttribute('aria-disabled') === 'true' ||
          targetButton.classList.contains('disabled');

        if (!isDisabled) {
          console.log('[Flow Automator] Generate button is active! Simulating user click:', targetButton);
          clickElementNaturally(targetButton);
          await delay(400);
          return true;
        } else {
          console.log('[Flow Automator] Button found but currently disabled. Waiting for UI state update...');
        }
      }

      await delay(500);
    }

    // If button was found even if still flagged, try clicking anyway
    if (targetButton) {
      console.log('[Flow Automator] Attempting click on button after wait timeout:', targetButton);
      clickElementNaturally(targetButton);
      await delay(400);
    }

    // Always dispatch Enter Keyboard sequence as reliable fallback
    console.log('[Flow Automator] Dispatching Enter KeyboardEvent sequence on input...');
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
      } catch (e) {
        // ignore form submit error
      }
    }

    await delay(300);
    return true;
  }

  function findGenerateButton(inputEl) {
    // 1. Check local container / parent form
    const container = inputEl.closest('form, div.prompt-bar, div.prompt-container, [role="form"], [class*="prompt" i], [class*="input" i]') || inputEl.parentElement;
    if (container) {
      const localButtons = container.querySelectorAll('button, [role="button"], md-icon-button, mwc-icon-button');
      for (const btn of localButtons) {
        if (isElementVisible(btn) && isSubmitOrGenerateButton(btn)) {
          return btn;
        }
      }
    }

    // 2. Global deep search across Shadow DOM
    const allButtons = querySelectorAllDeep('button, [role="button"], md-icon-button, mwc-icon-button');
    for (const btn of allButtons) {
      if (isElementVisible(btn) && isSubmitOrGenerateButton(btn)) {
        return btn;
      }
    }

    return null;
  }

  function isSubmitOrGenerateButton(btn) {
    if (!btn) return false;
    const type = (btn.getAttribute('type') || '').toLowerCase();
    if (type === 'submit') return true;

    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();

    const matchKeywords = ['generate', 'send', 'submit', 'run', 'create'];
    for (const kw of matchKeywords) {
      if (aria.includes(kw) || title.includes(kw) || text === kw) {
        return true;
      }
    }

    // Check SVG icons (paper plane, send, arrow-up)
    const svgs = btn.querySelectorAll('svg');
    for (const svg of svgs) {
      const svgAria = (svg.getAttribute('aria-label') || '').toLowerCase();
      if (matchKeywords.some(kw => svgAria.includes(kw))) return true;
      const path = svg.querySelector('path');
      if (path && (path.getAttribute('d') || '').length > 10) return true;
    }

    return false;
  }

  function clickElementNaturally(el) {
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const mouseOpts = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

    el.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    el.dispatchEvent(new MouseEvent('click', mouseOpts));
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
    const canvases = querySelectorAllDeep('canvas');
    for (const canvas of canvases) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl) snapshot.add(dataUrl);
      } catch (e) {
        // tainted
      }
    }
    return snapshot;
  }

  /**
   * Monitor DOM mutations and canvas/image changes to detect high-res render.
   * Extended 90-second timeout window with smart canvas observation.
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

        // 1. Check all rendered images
        const allImgs = querySelectorAllDeep('img').reverse();

        for (const img of allImgs) {
          const src = img.currentSrc || img.src;
          if (!src) continue;

          // Skip any asset that was present before this generation started
          if (initialSnapshot.has(src)) continue;

          // Skip avatars, icons, logos, svgs
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

          // Check if candidate is a completed high-res render (> 160px)
          if ((isBlob || isData || isHttp) && (width >= 160 || height >= 160 || (isBlob && width === 0))) {
            if (img.complete && (img.naturalWidth > 120 || isBlob || isData)) {
              cleanup();
              resolve(src);
              return;
            }
          }
        }

        // 2. Check all rendered HTML5 canvases (e.g. 16:9 comic illustrations)
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

      // Poll every 750ms
      pollTimer = setInterval(() => checkForNewAsset(), 750);

      // Extended timeout handling (90s default)
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
        targetInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
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
