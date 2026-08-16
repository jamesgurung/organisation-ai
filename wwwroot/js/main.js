const sidebar = document.getElementById('sidebar');
const chatContainer = document.getElementById('chat-container');
const chatContentContainer = document.getElementById('chat-content-container');
const chatForm = document.getElementById('chat-form');
const voiceArea = document.getElementById('voice-area');
const speakBtn = document.getElementById('speak');
const restartSpeakBtn = document.getElementById('restart-speak');
const userInput = document.getElementById('user-input');
const newChatBtn = document.getElementById('new-chat-btn');
const historyContainer = document.getElementById('chat-history');
const fileInput = document.getElementById('file-input');
const filePreview = document.getElementById('file-preview');
const presetsTab = document.getElementById('presets-tab');
const historyTab = document.getElementById('history-tab');
const reviewTab = document.getElementById('review-tab');
const presetsContainer = document.getElementById('presets-list');
const reviewContainer = document.getElementById('review-list');
const settingsDisplay = document.getElementById('settings-display');
const modelDisplay = document.getElementById('model-display');
const settingItemTemp = document.getElementById('setting-item-temperature');
const tempDisplay = document.getElementById('temp-display');
const settingItemReasoning = document.getElementById('setting-item-reasoning');
const settingItemWebSearch = document.getElementById('setting-item-web-search');
const settingItemDocumentSearch = document.getElementById('setting-item-document-search');
const settingItemImageGeneration = document.getElementById('setting-item-image-generation');
const instructionsIcon = document.getElementById('system-prompt-icon');
const instructionsPopup = document.getElementById('system-prompt-popup');
const instructionsCloseBtn = document.getElementById('system-prompt-close-btn');
const welcomeMessage = document.getElementById('welcome-message');
const introTextElement = document.getElementById('intro-text');
const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
const sendBtn = document.getElementById('send-btn');
const fileLabel = document.getElementById('file-label');
const fileUpload = document.getElementById('file-upload');
const inputContainer = document.getElementById('input-container');
const userElement = document.getElementById('user');
const reviewBadge = document.getElementById('review-badge');
const longChatWarning = document.getElementById('long-chat-warning');
const maxTurnsWarning = document.getElementById('max-turns-warning');
const smallScreenBreakpoint = 1200;
const sidebarTabs = [
  { name: 'presets', button: presetsTab, content: presetsContainer },
  { name: 'history', button: historyTab, content: historyContainer },
  { name: 'review', button: reviewTab, content: reviewContainer }
];

const headers = { 'X-XSRF-TOKEN': antiforgeryToken };

let isScrolledToBottom = true;
let mathIndex = 0;
const renderedPlainText = new WeakMap();
const streamingTextAnimations = new WeakMap();
const streamingAnimationDuration = 600;

marked.use({
  extensions: [{
    name: 'latex',
    level: 'inline',
    start(src) {
      const inlineIndex = src.indexOf('\\(');
      const displayIndex = src.indexOf('\\[');
      if (inlineIndex === -1) return displayIndex === -1 ? undefined : displayIndex;
      return displayIndex === -1 ? inlineIndex : Math.min(inlineIndex, displayIndex);
    },
    tokenizer(src) {
      const match = /^(\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/.exec(src);
      if (match) return { type: 'latex', raw: match[0], index: mathIndex++ };
    },
    renderer(token) {
      const span = document.createElement('span');
      span.textContent = token.raw;
      return `<span class="math-content" data-math-index="${token.index}">${span.innerHTML}</span>`;
    }
  }]
});

chatContainer.addEventListener('scroll', () => {
  isScrolledToBottom = chatContainer.scrollHeight - chatContainer.clientHeight <= chatContainer.scrollTop + 30;
});

const scrollChatContainer = () => {
  if (isScrolledToBottom) chatContainer.scrollTop = chatContainer.scrollHeight;
};

function toggleSidebar(e) {
  if (window.innerWidth < smallScreenBreakpoint) {
    sidebar.classList.toggle('open');
    e.stopPropagation();
  }
}

function closeSidebarIfOpen(e) {
  if (window.innerWidth < smallScreenBreakpoint && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== mobileSidebarToggle) {
    sidebar.classList.remove('open');
  }
}

function switchTab(tab) {
  const selectedTab = tab === 'presets' || tab === 'history' ? tab : 'review';
  sidebarTabs.forEach(({ name, button, content }) => {
    const isSelected = name === selectedTab;
    button.classList.toggle('active', isSelected);
    content.style.display = isSelected ? 'block' : 'none';
  });
}

function replaceSelectionQuery(type, id) {
  const url = new URL(location.href);
  url.searchParams.delete('template');
  url.searchParams.delete('conversation');
  if (type) url.searchParams.set(type, id);
  url.hash = '';
  const path = `${url.pathname}${url.search}`;
  if (`${location.pathname}${location.search}${location.hash}` === path) return;
  window.history.replaceState(window.history.state, '', path);
}

function parseSelectionQuery() {
  const parameters = new URLSearchParams(location.search);
  const templateId = parameters.get('template');
  const conversationId = parameters.get('conversation');
  if (templateId !== null && conversationId === null) return { type: 'template', id: templateId };
  if (conversationId !== null && templateId === null) return { type: 'conversation', id: conversationId };
  return null;
}

function navigateFromQuery() {
  const selection = parseSelectionQuery();
  if (selection?.type === 'template') {
    const preset = presets.find(item => item.id === selection.id);
    if (preset) {
      switchTab('presets');
      applyPreset(preset, false);
      return;
    }
  } else if (selection?.type === 'conversation') {
    const conversation = history.find(item => item.id === selection.id);
    if (conversation) {
      switchTab('history');
      loadChat(conversation.id, false);
      return;
    }
  }
  startNewChat();
}

function createListItem(text, onActivate) {
  const item = document.createElement('div');
  item.className = 'chat-list-item';
  item.tabIndex = 0;

  const textElement = document.createElement('div');
  textElement.className = 'chat-list-item-text';
  textElement.textContent = text;
  item.appendChild(textElement);

  item.addEventListener('click', onActivate);
  item.addEventListener('keydown', e => {
    if (e.target !== item || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onActivate();
  });
  return item;
}

function toggleInstructionsPopup() {
  const wasHidden = instructionsPopup.style.display === 'none' || !instructionsPopup.style.display;
  if (wasHidden) {
    instructionsPopup.style.display = 'block';
    const rect = instructionsIcon.getBoundingClientRect();
    instructionsPopup.style.top = rect.bottom + 8 + 'px';
    instructionsPopup.style.left = rect.left - 150 + 'px';
    document.addEventListener('click', closePopupOnClickOutside);
  } else {
    hideInstructionsPopup();
  }
}

function closePopupOnClickOutside(e) {
  if (e.target !== instructionsIcon && !instructionsPopup.contains(e.target))
    hideInstructionsPopup();
}

function hideInstructionsPopup() {
  instructionsPopup.style.display = 'none';
  document.removeEventListener('click', closePopupOnClickOutside);
}

function markdownToHtml(markdown) {
  mathIndex = 0;
  return marked.parse(markdown).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
}

async function typesetMath(elements) {
  const mathElements = Array.from(elements).filter(math => math.dataset.mathTypeset !== 'true');
  if (mathElements.length === 0 || typeof MathJax.typesetPromise !== 'function') return;
  mathElements.forEach(math => { math.dataset.mathTypeset = 'true'; });

  try {
    await MathJax.typesetPromise(mathElements);
  } catch (error) {
    console.error('MathJax typesetting failed.', error);
  }
}

async function renderMarkdown(element, markdown, streaming = false) {
  const renderedMath = new Map(Array.from(element.querySelectorAll('[data-math-index]'), math =>
    [math.dataset.mathIndex, math]));
  const template = document.createElement('template');
  template.innerHTML = markdownToHtml(markdown);
  const previousText = renderedPlainText.get(element) ?? '';
  const nextText = (template.content.textContent ?? '').trimEnd();
  const newMath = [];

  if (streaming && nextText.startsWith(previousText)) {
    const now = performance.now();
    const animations = (streamingTextAnimations.get(element) ?? [])
      .filter(animation => now - animation.startedAt < streamingAnimationDuration + animation.delay);
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let offset = 0;
    let animationIndex = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = offset;
      offset += node.textContent.length;
      if (node.parentElement?.closest('pre, code, .math-content, mjx-container, script, style')) continue;
      textNodes.push({ node, start, end: offset });
    }

    textNodes.forEach(({ node, start, end }) => {
      const splitIndex = Math.max(0, previousText.length - start);
      if (end <= previousText.length) return;
      Array.from(node.textContent.substring(splitIndex).matchAll(/\S+/g)).forEach(match => {
        const animationStart = start + splitIndex + match.index;
        animations.push({
          start: animationStart,
          end: animationStart + match[0].length,
          startedAt: now,
          delay: Math.min(animationIndex++ * 24, 120)
        });
      });
    });

    textNodes.forEach(({ node, start, end }) => {
      const nodeAnimations = animations
        .filter(animation => animation.end > start && animation.start < end)
        .sort((left, right) => left.start - right.start);
      if (nodeAnimations.length === 0) return;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      nodeAnimations.forEach(animation => {
        const animationStart = Math.max(0, animation.start - start);
        const animationEnd = Math.min(node.textContent.length, animation.end - start);
        if (animationStart > cursor)
          fragment.appendChild(document.createTextNode(node.textContent.substring(cursor, animationStart)));
        const span = document.createElement('span');
        span.className = 'streaming-text-fragment';
        span.style.animationDelay = `${animation.delay - (now - animation.startedAt)}ms`;
        span.textContent = node.textContent.substring(animationStart, animationEnd);
        fragment.appendChild(span);
        cursor = animationEnd;
      });
      if (cursor < node.textContent.length)
        fragment.appendChild(document.createTextNode(node.textContent.substring(cursor)));
      node.replaceWith(fragment);
    });
    streamingTextAnimations.set(element, animations);
  } else {
    streamingTextAnimations.delete(element);
  }

  template.content.querySelectorAll('[data-math-index]').forEach(math => {
    const rendered = renderedMath.get(math.dataset.mathIndex);
    if (rendered) math.replaceWith(rendered);
    else newMath.push(math);
  });

  element.replaceChildren(template.content);
  renderedPlainText.set(element, nextText);
  await typesetMath(newMath);
  if (streaming && (streamingTextAnimations.get(element)?.length ?? 0) > 0 &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    await new Promise(resolve => setTimeout(resolve, 16));
}

function clearRenderedContent(element) {
  if (element.hasChildNodes()) MathJax.typesetClear?.([element]);
  renderedPlainText.delete(element);
  streamingTextAnimations.delete(element);
  element.replaceChildren();
}

function wrapTables(el) {
  el.querySelectorAll('table').forEach(table => {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

function focusInput() {
  userInput.readOnly = true;
  userInput.focus();
  setTimeout(() => { userInput.readOnly = false; }, 10);
}

function init() {
  chatForm.addEventListener('submit', handleSubmit);
  mobileSidebarToggle.addEventListener('click', toggleSidebar);
  newChatBtn.addEventListener('click', startNewChat);
  fileInput.addEventListener('change', handleFileSelection);
  presetsTab.addEventListener('click', () => switchTab('presets'));
  historyTab.addEventListener('click', () => switchTab('history'));
  reviewTab.addEventListener('click', () => switchTab('review'));
  instructionsIcon.addEventListener('click', toggleInstructionsPopup);
  instructionsCloseBtn.addEventListener('click', hideInstructionsPopup);
  renderMarkdown(introTextElement, introText);
  reviewTab.style.display = reviewItems !== null ? 'block' : 'none';

  if (!showPresetDetails) {
    settingsDisplay.style.display = 'none';
    chatContainer.style.paddingTop = '15px';
  }

  if (!allowUploads) fileUpload.style.display = 'none';

  userInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.shiftKey) return;
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  });

  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = `${userInput.scrollHeight}px`;
    userInput.style.overflowY = userInput.scrollHeight > 200 ? 'auto' : 'hidden';
    sendBtn.disabled = userInput.value.trim().length === 0;
  });

  document.addEventListener('click', closeSidebarIfOpen);
  window.addEventListener('popstate', navigateFromQuery);

  if (reviewItems !== null) {
    if (reviewItems.length > 0) {
      reviewBadge.textContent = reviewItems.length;
      reviewBadge.style.display = 'block';
    }
    refreshReviewUI();
  }

  displayPresets();
  refreshHistoryUI();
  navigateFromQuery();
  focusInput();
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/js/worker.js'); });
}
