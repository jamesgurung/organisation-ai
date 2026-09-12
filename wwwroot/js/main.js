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
const streamingRenderers = new WeakMap();
const activeStreamingRenderers = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const streamingAnimationDuration = 450;

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

async function renderMarkdown(element, markdown) {
  clearRenderedContent(element);
  element.innerHTML = markdownToHtml(markdown);
  await typesetMath(element.querySelectorAll('[data-math-index]'));
}

function updateStreamingMarkdown(element, markdown, animate = true) {
  let state = streamingRenderers.get(element);
  const source = markdown.replace(/\r\n?/g, '\n');
  if (state && !source.startsWith(state.source)) {
    clearRenderedContent(element);
    state = null;
  }
  if (!state) {
    state = {
      element, source: '', offset: 0, drawn: 0, blocks: [], fragments: [],
      links: {}, linkRevision: 0, animations: new Set(), renders: new Set(), frame: null,
      ended: false, cancelled: false, completion: null, animate,
      draft: document.createElement('div')
    };
    state.draft.className = 'streaming-draft';
    element.appendChild(state.draft);
    streamingRenderers.set(element, state);
  }
  if (state.ended && source !== state.source) {
    state.completion?.resolve();
    state.completion = null;
    state.ended = false;
  }
  state.source = source;
  state.animate = animate;
  if (!state.draft.isConnected) element.appendChild(state.draft);
  activeStreamingRenderers.add(state);
  if (!animate || reducedMotion.matches)
    state.animations.forEach(animation => animation.finish());
  scheduleStreamingRender(state);
}

function scheduleStreamingRender(state) {
  if (state.cancelled) return;
  if (!state.animate || reducedMotion.matches) {
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    flushStreamingRender(state);
    return;
  }
  if (document.hidden || state.frame !== null) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = null;
    flushStreamingRender(state);
  });
}

function getStreamingBlocks(source, ended) {
  const tokens = marked.lexer(source);
  const blocks = [];
  let offset = 0;
  let start = 0;
  let mathClose = null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    // Keep an unfinished line's indentation in the tail for the next chunk.
    const raw = token.type === 'space' && !ended
      ? token.raw.slice(0, token.raw.lastIndexOf('\n') + 1)
      : token.raw;
    offset += raw.length;
    if (token.type !== 'code') {
      const text = token.raw.replace(/(`+)[\s\S]*?\1/g, '');
      for (const match of text.matchAll(/(?<!\\)(?:\\\\)*\\([()[\]])/g)) {
        if (!mathClose && (match[1] === '(' || match[1] === '['))
          mathClose = match[1] === '(' ? ')' : ']';
        else if (match[1] === mathClose) mathClose = null;
      }
    }
    const space = tokens[index + 1]?.type === 'space' ? tokens[index + 1].raw : '';
    const separator = ended ? space : space.slice(0, space.lastIndexOf('\n') + 1);
    const nextIndex = index + (space ? 2 : 1);
    const next = tokens[nextIndex];
    const nextSeparator = tokens[nextIndex + 1]?.type === 'space' ? tokens[nextIndex + 1].raw : '';
    const lineEnded = raw.endsWith('\n') || separator.startsWith('\n');
    const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/.exec(token.raw);
    const closedFence = token.type === 'code' && fence && lineEnded &&
      new RegExp(`\\n {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*\\n$`).test(raw.endsWith('\n') ? raw : `${raw}\n`);
    const complete = ended || closedFence ||
      (['heading', 'hr', 'space'].includes(token.type) && lineEnded) ||
      (['paragraph', 'def'].includes(token.type) && /\n[ \t]*\n/.test(separator || raw.slice(-2))) ||
      (next && /\n/.test(next.raw + nextSeparator));
    if (!complete) break;
    if (separator) {
      offset += separator.length;
      index++;
    }
    if (mathClose && !ended) continue;
    blocks.push({ start, end: offset });
    start = offset;
  }
  return blocks;
}

function flushStreamingRender(state) {
  if (state.cancelled) return;
  const animate = state.animate && !reducedMotion.matches;
  if (document.hidden && animate) return;
  let drawEnd = state.source.length;
  // A transport chunk can split a UTF-16 surrogate pair.
  if (!state.ended && /[\uD800-\uDBFF]/.test(state.source.at(-1) ?? '')) drawEnd--;
  let animationIndex = 0;
  for (const match of state.source.slice(state.drawn, drawEnd).matchAll(/\n|[^\S\n]+|\S+/gu)) {
    const text = match[0];
    const node = animate && /\S/.test(text) ? document.createElement('span') : document.createTextNode(text);
    node.textContent = text;
    const fragment = { node, start: state.drawn + match.index, end: state.drawn + match.index + text.length, animation: null };
    state.fragments.push(fragment);
    state.draft.appendChild(node);
    if (!animate || !/\S/.test(text)) continue;
    node.className = 'streaming-text-fragment';
    const animation = node.animate([
      { filter: 'blur(4px)', opacity: 0 },
      { filter: 'blur(0)', opacity: 1 }
    ], {
      duration: streamingAnimationDuration,
      // Preserve the original reveal, trimming its nearly settled final 150ms.
      easing: 'cubic-bezier(0.2565, 0.5433, 0.3193, 0.9153)',
      delay: Math.min(animationIndex++ * 18, 90),
      fill: 'both'
    });
    fragment.animation = animation;
    state.animations.add(animation);
    animation.finished.then(() => {
      fragment.animation = null;
      state.animations.delete(animation);
      fragment.node = document.createTextNode(node.textContent);
      node.replaceWith(fragment.node);
      animation.cancel();
      if (!state.cancelled) scheduleStreamingRender(state);
    }, () => {});
  }
  state.drawn = drawEnd;

  const ranges = getStreamingBlocks(state.source.slice(state.offset, drawEnd), state.ended);
  const base = state.offset;
  for (const range of ranges) {
    const end = base + range.end;
    const crossing = state.fragments.find(fragment => fragment.start < end && fragment.end > end);
    // Do not split or replace a fragment while its entrance is still running.
    if (crossing?.animation) break;
    if (crossing) {
      const remainder = document.createTextNode(crossing.node.textContent.slice(end - crossing.start));
      crossing.node.textContent = crossing.node.textContent.slice(0, end - crossing.start);
      crossing.node.after(remainder);
      state.fragments.splice(state.fragments.indexOf(crossing) + 1, 0,
        { node: remainder, start: end, end: crossing.end, animation: null });
      crossing.end = end;
    }
    const element = document.createElement('div');
    element.className = 'streaming-draft';
    state.draft.before(element);
    const fragments = state.fragments.filter(fragment => fragment.end <= end);
    fragments.forEach(fragment => element.appendChild(fragment.node));
    state.fragments = state.fragments.filter(fragment => fragment.end > end);
    const source = state.source.slice(state.offset, end);
    const block = { source, element, fragments, nodes: [element], html: null, rendering: false };
    state.blocks.push(block);
    state.offset = end;
    // Paragraph separators belong to the source, but spacing belongs to CSS.
    for (const fragment of [...fragments].reverse()) {
      fragment.node.textContent = fragment.node.textContent.trimEnd();
      if (fragment.node.textContent) break;
    }
    const definitions = marked.lexer(source).links;
    for (const [key, value] of Object.entries(definitions)) {
      if (Object.hasOwn(state.links, key)) continue;
      state.links[key] = value;
      state.linkRevision++;
    }
  }

  for (const block of state.blocks) {
    if (block.rendering || block.fragments.some(fragment => fragment.animation)) continue;
    if (block.html !== null && block.linkRevision === state.linkRevision) continue;
    block.linkRevision = state.linkRevision;
    mathIndex = 0;
    const lexer = new marked.Lexer();
    lexer.tokens.links = { ...state.links };
    const html = marked.parser(lexer.lex(block.source)).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
    if (html === block.html) continue;
    const render = renderStreamingBlock(state, block, html);
    state.renders.add(render);
    render.catch(error => {
      console.error('Streaming Markdown rendering failed.', error);
      cancelStreamingMarkdown(state.element, true);
    }).finally(() => {
      state.renders.delete(render);
      if (!state.cancelled) scheduleStreamingRender(state);
    });
  }
  if (state.ended && state.drawn === state.source.length && state.offset === state.drawn &&
    state.animations.size === 0 && state.renders.size === 0) {
    state.draft.remove();
    activeStreamingRenderers.delete(state);
    state.completion?.resolve();
  }
  scrollChatContainer();
}

async function renderStreamingBlock(state, block, html) {
  block.rendering = true;
  block.html = html;
  const container = document.createElement('div');
  container.innerHTML = html;
  wrapTables(container);
  const math = Array.from(container.querySelectorAll('[data-math-index]'));
  const nodes = Array.from(container.childNodes);
  // A marker keeps even invisible definition blocks addressable for later references.
  if (nodes.length === 0) nodes.push(document.createComment('markdown'));
  const anchor = isScrolledToBottom ? null : Array.from(chatContentContainer.querySelectorAll('p, pre, li, .streaming-draft'))
    .find(element => !block.nodes.some(node => node === element || node.contains(element)) &&
      element.getBoundingClientRect().bottom > chatContainer.getBoundingClientRect().top);
  const top = anchor?.getBoundingClientRect().top;
  block.nodes[0].before(...nodes);
  block.nodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) MathJax.typesetClear?.([node]);
    node.remove();
  });
  block.nodes = nodes;
  block.fragments = [];
  if (anchor?.isConnected) chatContainer.scrollTop += anchor.getBoundingClientRect().top - top;
  scrollChatContainer();
  await typesetMath(math);
  if (state.cancelled) {
    MathJax.typesetClear?.(math);
    return;
  }
  if (anchor?.isConnected && !isScrolledToBottom)
    chatContainer.scrollTop += anchor.getBoundingClientRect().top - top;
  block.rendering = false;
  scrollChatContainer();
}

function finishStreamingMarkdown(element) {
  const state = streamingRenderers.get(element);
  if (!state || state.cancelled) return Promise.resolve();
  state.ended = true;
  state.completion ??= Promise.withResolvers();
  activeStreamingRenderers.add(state);
  scheduleStreamingRender(state);
  return state.completion.promise;
}

function cancelStreamingMarkdown(element, preserve = false) {
  for (const state of activeStreamingRenderers) {
    if (state.element !== element && !element?.contains(state.element)) continue;
    state.cancelled = true;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.animations.forEach(animation => animation.cancel());
    state.animations.clear();
    state.completion?.resolve();
    streamingRenderers.delete(state.element);
    activeStreamingRenderers.delete(state);
    if (preserve) {
      MathJax.typesetClear?.([state.element]);
      state.element.innerHTML = markdownToHtml(state.source);
      wrapTables(state.element);
      typesetMath(state.element.querySelectorAll('[data-math-index]'));
    }
  }
}

function updateStreamingVisibility() {
  for (const state of activeStreamingRenderers) {
    for (const animation of state.animations) {
      if (reducedMotion.matches || !state.animate) animation.finish();
      else if (document.hidden) animation.pause();
      else animation.play();
    }
    scheduleStreamingRender(state);
  }
}

document.addEventListener('visibilitychange', updateStreamingVisibility);
reducedMotion.addEventListener('change', updateStreamingVisibility);

function clearRenderedContent(element) {
  cancelStreamingMarkdown(element);
  streamingRenderers.delete(element);
  if (element.hasChildNodes()) MathJax.typesetClear?.([element]);
  element.replaceChildren();
}

function wrapTables(el) {
  el.querySelectorAll('table').forEach(table => {
    if (table.parentElement.classList.contains('table-wrapper')) return;
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
