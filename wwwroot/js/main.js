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
const reasoningDisplay = document.getElementById('reasoning-display');
const instructionsIcon = document.getElementById('system-prompt-icon');
const instructionsPopup = document.getElementById('system-prompt-popup');
const welcomeMessage = document.getElementById('welcome-message');
const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
const sendBtn = document.getElementById('send-btn');
const fileLabel = document.getElementById('file-label');
const inputContainer = document.getElementById('input-container');
const userElement = document.getElementById('user');
const reviewBadge = document.getElementById('review-badge');
const longChatWarning = document.getElementById('long-chat-warning');
const smallScreenBreakpoint = 1200;

const headers = { 'X-XSRF-TOKEN': antiforgeryToken };

let isScrolledToBottom = true;

chatContainer.addEventListener('scroll', function() {
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
  if (tab === 'presets') {
    presetsTab.classList.add('active');
    historyTab.classList.remove('active');
    reviewTab.classList.remove('active');
    presetsContainer.style.display = 'block';
    historyContainer.style.display = 'none';
    reviewContainer.style.display = 'none';
  } else if (tab === 'history') {
    historyTab.classList.add('active');
    presetsTab.classList.remove('active');
    reviewTab.classList.remove('active');
    presetsContainer.style.display = 'none';
    historyContainer.style.display = 'block';
    reviewContainer.style.display = 'none';
  } else {
    reviewTab.classList.add('active');
    presetsTab.classList.remove('active');
    historyTab.classList.remove('active');
    presetsContainer.style.display = 'none';
    historyContainer.style.display = 'none';
    reviewContainer.style.display = 'block';
  }
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
  if (e.target !== instructionsIcon && !instructionsPopup.contains(e.target)) {
    hideInstructionsPopup();
  }
}

function hideInstructionsPopup() {
  instructionsPopup.style.display = 'none';
  document.removeEventListener('click', closePopupOnClickOutside);
}

function markdownToHtml(markdown) {
  return marked.parse(markdown).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
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

async function init() {
  chatForm.addEventListener('submit', handleSubmit);
  mobileSidebarToggle.addEventListener('click', toggleSidebar);
  newChatBtn.addEventListener('click', startNewChat);
  fileInput.addEventListener('change', handleFileSelection);
  presetsTab.addEventListener('click', () => switchTab('presets'));
  historyTab.addEventListener('click', () => switchTab('history'));
  reviewTab.addEventListener('click', () => switchTab('review'));
  instructionsIcon.addEventListener('click', toggleInstructionsPopup);
  const sysCloseBtn = document.getElementById('system-prompt-close-btn');
  sysCloseBtn.addEventListener('click', hideInstructionsPopup);
  document.getElementById('intro-text').innerHTML = markdownToHtml(introText);
  reviewTab.style.display = reviewItems !== null ? 'block' : 'none';

  if (!showPresetDetails) {
    settingsDisplay.style.display = 'none';
    chatContainer.style.paddingTop = '15px';
  }

  if (!allowUploads) {
    document.getElementById('file-upload').style.display = 'none';
  }

  userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.altKey || e.shiftKey) {
        return;
      } else {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.scrollHeight > 200) {
      this.style.overflowY = 'auto';
    } else {
      this.style.overflowY = 'hidden';
    }
    sendBtn.disabled = this.value.trim().length === 0;
  });

  document.addEventListener('click', closeSidebarIfOpen);

  if (reviewItems !== null) {
    if (reviewItems.length > 0) {
      reviewBadge.textContent = reviewItems.length;
      reviewBadge.style.display = 'block';
    }
    refreshReviewUI();
  }

  await displayPresets();
  await refreshHistoryUI();
  startNewChat();
  focusInput();
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/js/worker.js'); });
}