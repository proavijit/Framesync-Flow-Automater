/**
 * Antigravity Flow Automator - Popup Dashboard Controller (v1.1.0)
 * Features:
 * - Multi-Character Rules & Persistent Anchor Management
 * - Image Reference Mapping with Base64 Conversion
 * - Dynamic Character Attribute Expansion in Bulk Prompts
 * - Robust Regex Stream Parser with Timestamp Tagging
 * - Queue State Machine, Exponential Backoff & UI Telemetry
 */

// Queue State Machine
class FlowQueueManager {
  constructor() {
    this.queue = [];
    this.currentIndex = -1;
    this.status = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped'
    this.maxRetries = 2;
    this.timeoutMs = 45000; // 45s generation timeout
    this.activeTabId = null;

    this.stats = {
      total: 0,
      pending: 0,
      success: 0,
      failed: 0
    };

    this.listeners = new Set();
  }

  onUpdate(fn) {
    this.listeners.add(fn);
  }

  notify() {
    this.updateStats();
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error('Queue listener error:', err);
      }
    }
  }

  updateStats() {
    this.stats.total = this.queue.length;
    this.stats.pending = this.queue.filter(i => i.status === 'pending').length;
    this.stats.success = this.queue.filter(i => i.status === 'success').length;
    this.stats.failed = this.queue.filter(i => i.status === 'failed').length;
  }

  loadPrompts(parsedItems, folderName, globalAnchor, characterRules = []) {
    this.queue = parsedItems.map((item, idx) => {
      // 1. Expand Character Attributes if characters are mentioned
      const expansion = expandCharacterAttributes(item.rawPrompt, characterRules);
      let promptWithChars = expansion.expandedPrompt;

      // 2. Prepend Global Art Style / Anchor if present
      let fullPrompt = promptWithChars;
      if (globalAnchor && globalAnchor.trim().length > 0) {
        fullPrompt = `${globalAnchor.trim()}\n${promptWithChars}`;
      }

      return {
        id: `item-${idx}-${Date.now()}`,
        tag: item.tag,
        rawPrompt: item.rawPrompt.trim(),
        fullPrompt: fullPrompt.trim(),
        detectedCharacters: expansion.detectedCharacters,
        referenceImages: expansion.referenceImages,
        folder: folderName.trim() || 'Default-Flow',
        status: 'pending',
        retries: 0,
        error: null,
        imageUrl: null
      };
    });

    this.currentIndex = -1;
    this.status = 'idle';
    this.notify();
  }

  retryFailedItems() {
    let resetCount = 0;
    for (const item of this.queue) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.retries = 0;
        item.error = null;
        resetCount++;
      }
    }
    if (resetCount > 0) {
      this.status = 'idle';
      this.notify();
    }
    return resetCount;
  }

  pause() {
    if (this.status === 'running') {
      this.status = 'paused';
      this.notify();
    }
  }

  resume() {
    if (this.status === 'paused') {
      this.status = 'running';
      this.notify();
      this.processNext();
    }
  }

  stop() {
    this.status = 'stopped';
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      const activeItem = this.queue[this.currentIndex];
      if (activeItem.status === 'generating') {
        activeItem.status = 'pending';
      }
    }
    this.notify();
  }

  async start(activeTabId) {
    this.activeTabId = activeTabId;
    this.status = 'running';
    this.notify();
    await this.processNext();
  }

  async processNext() {
    if (this.status !== 'running') return;

    const nextIdx = this.queue.findIndex(i => i.status === 'pending');
    if (nextIdx === -1) {
      this.status = 'idle';
      this.notify();
      return;
    }

    this.currentIndex = nextIdx;
    const currentItem = this.queue[nextIdx];
    currentItem.status = 'generating';
    this.notify();

    let attemptSuccess = false;
    let lastError = null;

    while (currentItem.retries <= this.maxRetries && !attemptSuccess) {
      if (this.status !== 'running') {
        if (currentItem.status === 'generating') {
          currentItem.status = 'pending';
          this.notify();
        }
        return;
      }

      if (currentItem.retries > 0) {
        const backoffWait = Math.pow(2, currentItem.retries) * 1000;
        this.emitLog(`Retrying ${currentItem.tag} (Attempt ${currentItem.retries + 1}/${this.maxRetries + 1}) after ${backoffWait / 1000}s backoff...`, 'warn');
        await new Promise(r => setTimeout(r, backoffWait));
        if (this.status !== 'running') return;
      }

      try {
        const charCount = currentItem.detectedCharacters?.length || 0;
        const imgCount = currentItem.referenceImages?.length || 0;
        const charDetail = charCount > 0 ? ` (Detected: ${currentItem.detectedCharacters.join(', ')} | ${imgCount} Ref Img)` : '';
        this.emitLog(`[${currentItem.tag}] Dispatching generation${charDetail}...`, 'info');

        const response = await this.sendTabMessageWithTimeout(this.activeTabId, {
          action: 'GENERATE_PROMPT',
          payload: {
            tag: currentItem.tag,
            prompt: currentItem.fullPrompt,
            referenceImages: currentItem.referenceImages || [],
            timeoutMs: this.timeoutMs
          }
        }, this.timeoutMs + 5000);

        if (response && response.success && response.imageUrl) {
          attemptSuccess = true;
          currentItem.imageUrl = response.imageUrl;
          currentItem.status = 'success';
          currentItem.error = null;

          this.emitLog(`[${currentItem.tag}] Render detected! Initiating download...`, 'success');
          await this.downloadAsset(currentItem);
        } else {
          throw new Error(response?.error || 'Content script reported generation failure.');
        }
      } catch (err) {
        lastError = err.message || String(err);
        currentItem.retries++;
        this.emitLog(`[${currentItem.tag}] Generation attempt ${currentItem.retries} failed: ${lastError}`, 'warn');
      }
    }

    if (!attemptSuccess) {
      currentItem.status = 'failed';
      currentItem.error = lastError;
      this.emitLog(`[${currentItem.tag}] Marked as FAILED after ${this.maxRetries + 1} attempts.`, 'error');
    }

    this.notify();

    if (this.status === 'running') {
      await new Promise(r => setTimeout(r, 1500));
      this.processNext();
    }
  }

  async sendTabMessageWithTimeout(tabId, message, timeout) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Operation timed out after ${Math.round(timeout / 1000)}s waiting for image render.`));
      }, timeout);

      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(response);
      });
    });
  }

  async downloadAsset(item) {
    const filename = `${item.folder}/${item.tag}.png`;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_IMAGE',
        payload: {
          url: item.imageUrl,
          filename: filename,
          tag: item.tag,
          folder: item.folder
        }
      }, (res) => {
        if (chrome.runtime.lastError || (res && !res.success)) {
          const err = chrome.runtime.lastError?.message || res?.error;
          this.emitLog(`[${item.tag}] Download error: ${err}`, 'error');
        } else {
          this.emitLog(`[${item.tag}] Download initiated: ${filename}`, 'success');
        }
        resolve();
      });
    });
  }

  emitLog(message, level = 'info') {
    if (typeof window !== 'undefined' && window.logToTerminal) {
      window.logToTerminal(message, level);
    }
  }
}

// Regex Parser for Bulk Prompts
export function parseBulkPrompts(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const promptRegex = /#(\d+-\d+)\s*\n([\s\S]*?)(?=(?:\n#\d+-\d+|$))/g;
  const items = [];
  let match;

  while ((match = promptRegex.exec(normalized)) !== null) {
    const tag = match[1].trim();
    const promptText = match[2].trim();
    if (tag && promptText) {
      items.push({
        tag: tag,
        rawPrompt: promptText
      });
    }
  }

  return items;
}

/**
 * Dynamic Character Detection & Visual Attribute Expansion
 * Scans prompt text for registered character names (e.g. "Man 01", "Julian")
 * Appends locked visual attributes if not already expanded.
 * Maps associated reference images to the prompt item.
 */
export function expandCharacterAttributes(rawPrompt, characterRules) {
  if (!characterRules || characterRules.length === 0) {
    return {
      expandedPrompt: rawPrompt,
      detectedCharacters: [],
      referenceImages: []
    };
  }

  const detected = [];
  const refImages = [];
  const attributeAppendList = [];

  for (const char of characterRules) {
    if (!char.name || !char.name.trim()) continue;

    const trimmedName = char.name.trim();
    // Escape special regex chars in character name
    const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundary matching (allowing spaces or hyphens)
    const nameRegex = new RegExp(`\\b${escapedName}\\b`, 'i');

    if (nameRegex.test(rawPrompt)) {
      detected.push(trimmedName);

      if (char.attributes && char.attributes.trim()) {
        const trimmedAttrs = char.attributes.trim();
        // Only append if the attributes are not already present in the prompt text
        if (!rawPrompt.toLowerCase().includes(trimmedAttrs.toLowerCase())) {
          attributeAppendList.push(`[Character - ${trimmedName}: ${trimmedAttrs}]`);
        }
      }

      if (char.imageBase64) {
        refImages.push({
          characterName: trimmedName,
          dataUrl: char.imageBase64,
          fileName: char.imageName || `${trimmedName}.png`
        });
      }
    }
  }

  let expanded = rawPrompt;
  if (attributeAppendList.length > 0) {
    expanded = `${rawPrompt}\n${attributeAppendList.join('\n')}`;
  }

  return {
    expandedPrompt: expanded,
    detectedCharacters: detected,
    referenceImages: refImages
  };
}

// UI Controller & Character Manager
document.addEventListener('DOMContentLoaded', async () => {
  const folderInput = document.getElementById('folder-input');
  const anchorInput = document.getElementById('anchor-input');
  const bulkPromptsInput = document.getElementById('bulk-prompts');
  const tabStatusEl = document.getElementById('tab-status');
  const tabStatusLabel = tabStatusEl.querySelector('.status-label');

  const charSection = document.querySelector('.character-section');
  const charSectionToggle = document.getElementById('char-section-toggle');
  const charCountBadge = document.getElementById('char-count-badge');
  const btnAddChar = document.getElementById('btn-add-char');
  const characterListEl = document.getElementById('character-list');

  const btnParse = document.getElementById('btn-parse');
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const btnRetryFailed = document.getElementById('btn-retry-failed');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  const statTotal = document.getElementById('stat-total');
  const statPending = document.getElementById('stat-pending');
  const statSuccess = document.getElementById('stat-success');
  const statFailed = document.getElementById('stat-failed');

  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressPercent = document.getElementById('progress-percent');
  const currentItemBanner = document.getElementById('current-item-banner');
  const currentTag = document.getElementById('current-tag');
  const currentPromptSnippet = document.getElementById('current-prompt-snippet');
  const terminalLogs = document.getElementById('terminal-logs');

  const queueManager = new FlowQueueManager();
  let currentActiveTab = null;

  // Character Profiles State
  let characterProfiles = [
    {
      id: 'char-1',
      name: 'Man 01',
      attributes: 'young adult man, short dark brown hair, slate-blue half-zip pullover, hazel eyes',
      imageBase64: null,
      imageName: null
    }
  ];

  // Accordion Toggle
  charSectionToggle.addEventListener('click', (e) => {
    // Don't toggle if clicking "+ Add Character" button directly
    if (e.target.closest('#btn-add-char')) return;
    charSection.classList.toggle('collapsed');
  });

  // Global Log function
  window.logToTerminal = (message, level = 'info') => {
    const time = new Date().toTimeString().split(' ')[0];
    const logLine = document.createElement('div');
    logLine.className = `log-line log-${level}`;
    logLine.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-msg">${escapeHtml(message)}</span>`;
    terminalLogs.appendChild(logLine);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  };

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // Load Saved Data from chrome.storage.local
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['folderName', 'characterAnchor', 'bulkPrompts', 'characterProfiles'], (result) => {
      if (result.folderName) folderInput.value = result.folderName;
      if (result.characterAnchor) anchorInput.value = result.characterAnchor;
      if (result.bulkPrompts) bulkPromptsInput.value = result.bulkPrompts;
      if (Array.isArray(result.characterProfiles) && result.characterProfiles.length > 0) {
        characterProfiles = result.characterProfiles;
      }
      renderCharacterList();
    });

    const persistForm = () => {
      chrome.storage.local.set({
        folderName: folderInput.value,
        characterAnchor: anchorInput.value,
        bulkPrompts: bulkPromptsInput.value,
        characterProfiles: characterProfiles
      });
    };

    folderInput.addEventListener('input', persistForm);
    anchorInput.addEventListener('input', persistForm);
    bulkPromptsInput.addEventListener('input', persistForm);
  } else {
    renderCharacterList();
  }

  function persistCharacters() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ characterProfiles });
    }
  }

  // Character Cards Rendering & Event Handling
  function renderCharacterList() {
    characterListEl.innerHTML = '';
    charCountBadge.textContent = `${characterProfiles.length} Profile${characterProfiles.length === 1 ? '' : 's'}`;

    characterProfiles.forEach((char, idx) => {
      const card = document.createElement('div');
      card.className = 'character-card';
      card.dataset.id = char.id;

      card.innerHTML = `
        <div class="char-card-header">
          <input 
            type="text" 
            class="char-name-input" 
            placeholder="Character Name (e.g. Man 01)" 
            value="${escapeHtml(char.name || '')}"
          >
          <button class="btn-remove-char" title="Delete Character Profile" type="button">&times;</button>
        </div>
        <textarea 
          class="char-attributes-input" 
          rows="2" 
          placeholder="Locked Visual Attributes (e.g. short brown hair, slate-blue pullover)"
        >${escapeHtml(char.attributes || '')}</textarea>
        <div class="char-reference-row">
          <div class="char-image-preview-group">
            ${char.imageBase64 
              ? `<img src="${char.imageBase64}" class="char-thumbnail" alt="Ref" />
                 <span class="char-image-name" title="${escapeHtml(char.imageName || 'Ref Image')}">${escapeHtml(char.imageName || 'Ref Image')}</span>
                 <button type="button" class="btn-clear-image" title="Remove image">&times;</button>`
              : `<span class="field-hint">No reference image linked</span>`
            }
          </div>
          <label class="char-file-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            ${char.imageBase64 ? 'Replace Image' : 'Link Image'}
            <input type="file" class="char-file-input" accept="image/*">
          </label>
        </div>
      `;

      // Inputs Listeners
      const nameInput = card.querySelector('.char-name-input');
      const attrInput = card.querySelector('.char-attributes-input');
      const fileInput = card.querySelector('.char-file-input');
      const btnRemove = card.querySelector('.btn-remove-char');
      const btnClearImg = card.querySelector('.btn-clear-image');

      nameInput.addEventListener('input', (e) => {
        char.name = e.target.value;
        persistCharacters();
      });

      attrInput.addEventListener('input', (e) => {
        char.attributes = e.target.value;
        persistCharacters();
      });

      btnRemove.addEventListener('click', () => {
        characterProfiles = characterProfiles.filter(c => c.id !== char.id);
        renderCharacterList();
        persistCharacters();
      });

      if (btnClearImg) {
        btnClearImg.addEventListener('click', () => {
          char.imageBase64 = null;
          char.imageName = null;
          renderCharacterList();
          persistCharacters();
        });
      }

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (readEvent) => {
          const rawDataUrl = readEvent.target.result;
          // Downscale large image to prevent exceeding chrome storage limits
          optimizeImageBase64(rawDataUrl, (optimizedDataUrl) => {
            char.imageBase64 = optimizedDataUrl;
            char.imageName = file.name;
            renderCharacterList();
            persistCharacters();
            window.logToTerminal(`Linked reference image "${file.name}" to character "${char.name}".`, 'info');
          });
        };
        reader.readAsDataURL(file);
      });

      characterListEl.appendChild(card);
    });
  }

  // Downscale image helper for storage efficiency
  function optimizeImageBase64(dataUrl, callback) {
    const img = new Image();
    img.onload = () => {
      const maxDim = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => callback(dataUrl);
    img.src = dataUrl;
  }

  // Add Character Profile Action
  btnAddChar.addEventListener('click', (e) => {
    e.stopPropagation();
    charSection.classList.remove('collapsed');
    const newId = `char-${Date.now()}`;
    const nextNum = characterProfiles.length + 1;
    characterProfiles.push({
      id: newId,
      name: `Character ${nextNum < 10 ? '0' + nextNum : nextNum}`,
      attributes: '',
      imageBase64: null,
      imageName: null
    });
    renderCharacterList();
    persistCharacters();
    // Scroll to new card
    setTimeout(() => {
      characterListEl.scrollTop = characterListEl.scrollHeight;
    }, 50);
  });

  // Verify Active Tab Connection
  async function checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        setTabStatus(false, 'No Active Tab');
        return null;
      }

      currentActiveTab = tab;

      try {
        const pingRes = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: 'PING' }, (res) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(res);
          });
        });

        if (pingRes && pingRes.status === 'READY') {
          setTabStatus(true, `Flow Connected (${tab.title?.slice(0, 15) || 'Tab'}...)`);
          return tab;
        }
      } catch (e) {
        if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['scripts/content.js']
            });
            setTabStatus(true, 'Flow Attached');
            window.logToTerminal('Content script injected into active tab.', 'info');
            return tab;
          } catch (injErr) {
            setTabStatus(false, 'Injection Restricted');
            window.logToTerminal(`Tab injection error: ${injErr.message}`, 'warn');
            return null;
          }
        } else {
          setTabStatus(false, 'Unsupported Page');
          return null;
        }
      }
    } catch (err) {
      setTabStatus(false, 'Tab Check Failed');
      return null;
    }
  }

  function setTabStatus(connected, text) {
    tabStatusEl.className = `tab-badge ${connected ? 'connected' : 'disconnected'}`;
    tabStatusLabel.textContent = text;
  }

  await checkActiveTab();

  // Queue State UI Synchronization
  queueManager.onUpdate((qm) => {
    statTotal.textContent = qm.stats.total;
    statPending.textContent = qm.stats.pending;
    statSuccess.textContent = qm.stats.success;
    statFailed.textContent = qm.stats.failed;

    const processed = qm.stats.success + qm.stats.failed;
    const total = qm.stats.total;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;

    if (qm.status === 'running' && qm.currentIndex >= 0 && qm.currentIndex < qm.queue.length) {
      const activeItem = qm.queue[qm.currentIndex];
      currentItemBanner.style.display = 'flex';
      currentTag.textContent = `#${activeItem.tag}`;
      currentPromptSnippet.textContent = activeItem.fullPrompt.slice(0, 60) + '...';
      progressText.textContent = `Processed: ${processed}/${total} | Failed: ${qm.stats.failed}`;
    } else {
      currentItemBanner.style.display = 'none';
      if (qm.status === 'paused') {
        progressText.textContent = `Paused (${processed}/${total})`;
      } else if (qm.status === 'stopped') {
        progressText.textContent = `Stopped (${processed}/${total})`;
      } else if (qm.status === 'idle' && total > 0 && processed === total) {
        progressText.textContent = `Completed all ${total} items!`;
      } else {
        progressText.textContent = total > 0 ? `Ready (${total} queued)` : 'Ready to run';
      }
    }

    btnStart.disabled = qm.status === 'running' || (qm.stats.pending === 0 && qm.stats.total > 0);
    btnPause.disabled = qm.status !== 'running';
    btnStop.disabled = qm.status !== 'running' && qm.status !== 'paused';
    btnRetryFailed.disabled = qm.stats.failed === 0 || qm.status === 'running';

    if (qm.status === 'paused') {
      btnPause.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg> Resume`;
      btnPause.disabled = false;
    } else {
      btnPause.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg> Pause`;
    }
  });

  // Action: Parse Prompts
  function handleParse() {
    const raw = bulkPromptsInput.value;
    const items = parseBulkPrompts(raw);
    if (items.length === 0) {
      window.logToTerminal('No valid timestamped prompts found. Expected format: #0-00\\nPrompt text', 'warn');
      return [];
    }

    queueManager.loadPrompts(items, folderInput.value, anchorInput.value, characterProfiles);

    let totalCharsDetected = 0;
    let totalRefImagesLinked = 0;
    queueManager.queue.forEach(q => {
      totalCharsDetected += q.detectedCharacters?.length || 0;
      totalRefImagesLinked += q.referenceImages?.length || 0;
    });

    window.logToTerminal(`Parsed ${items.length} prompts. Characters matched: ${totalCharsDetected}, Reference images mapped: ${totalRefImagesLinked}.`, 'success');
    return items;
  }

  btnParse.addEventListener('click', handleParse);

  // Action: Start
  btnStart.addEventListener('click', async () => {
    let tab = currentActiveTab;
    if (!tab) {
      tab = await checkActiveTab();
    }
    if (!tab) {
      window.logToTerminal('Error: Cannot connect to active Google Flow tab.', 'error');
      return;
    }

    if (queueManager.queue.length === 0 || queueManager.stats.pending === 0) {
      const items = handleParse();
      if (items.length === 0) return;
    }

    window.logToTerminal(`Starting queue execution for ${queueManager.queue.length} items...`, 'info');
    queueManager.start(tab.id);
  });

  // Action: Pause / Resume
  btnPause.addEventListener('click', () => {
    if (queueManager.status === 'running') {
      queueManager.pause();
      window.logToTerminal('Queue paused by user.', 'warn');
    } else if (queueManager.status === 'paused') {
      window.logToTerminal('Resuming queue...', 'info');
      queueManager.resume();
    }
  });

  // Action: Stop
  btnStop.addEventListener('click', () => {
    queueManager.stop();
    window.logToTerminal('Queue stopped by user.', 'error');
  });

  // Action: Retry All Failed
  btnRetryFailed.addEventListener('click', async () => {
    const count = queueManager.retryFailedItems();
    if (count > 0) {
      window.logToTerminal(`Re-queued ${count} failed items for execution.`, 'info');
      let tab = currentActiveTab || await checkActiveTab();
      if (tab) {
        queueManager.start(tab.id);
      }
    }
  });

  // Action: Clear Logs
  btnClearLogs.addEventListener('click', () => {
    terminalLogs.innerHTML = '';
    window.logToTerminal('Logs cleared.', 'system');
  });
});
