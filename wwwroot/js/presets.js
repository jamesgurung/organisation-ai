let currentPreset = null;

async function displayPresets() {
  presetsContainer.innerHTML = '';

  const grouped = {};
  presets.filter(preset => preset.id !== 'default').forEach(preset => {
    const cat = preset.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(preset);
  });

  Object.keys(grouped).forEach(category => {
    const catHeader = document.createElement('div');
    catHeader.textContent = category;
    catHeader.className = 'preset-category-header';
    presetsContainer.appendChild(catHeader);
    grouped[category].forEach(preset => {
      const presetItem = document.createElement('div');
      presetItem.className = 'chat-list-item';
      const textDiv = document.createElement('div');
      textDiv.className = 'chat-list-item-text';
      textDiv.textContent = preset.title;
      presetItem.appendChild(textDiv);
      presetItem.addEventListener('click', () => applyPreset(preset, false));
      presetsContainer.appendChild(presetItem);
    });
  });
}

function applyPreset(preset, isReviewing) {
  currentChatId = null;
  currentPreset = preset;
  stopRealtimeSpeech();

  if (showPresetDetails) {
    modelDisplay.textContent = currentPreset.model;
    const hasTemperature = currentPreset.temperature !== undefined && currentPreset.temperature !== null;
    settingItemTemp.style.display = hasTemperature ? 'flex' : 'none';
    tempDisplay.textContent = currentPreset.temperature?.toFixed(1) ?? '';
    const reasoning = currentPreset.reasoningEffort && currentPreset.reasoningEffort !== 'none' && currentPreset.reasoningEffort !== 'minimal';
    settingItemReasoning.style.display = reasoning ? 'flex' : 'none';
    reasoningDisplay.textContent = !reasoning || currentPreset.reasoningEffort == 'low' ? '' : currentPreset.reasoningEffort;
    instructionsDiv = instructionsPopup.querySelector('div');
    instructionsDiv.textContent = currentPreset.instructions;
    instructionsDiv.scrollTop = 0;
  }

  chatContentContainer.innerHTML = '';
  welcomeMessage.style.display = currentPreset.introduction ? 'none' : 'block';
  const activeChats = document.querySelectorAll('.chat-list-item.active');
  activeChats.forEach(chat => chat.classList.remove('active'));
  const presetItems = document.querySelectorAll('.chat-list-item');
  presetItems.forEach(item => {
    if (item.textContent === currentPreset.title && !isReviewing) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  longChatWarning.style.display = 'none';
  inputContainer.style.display = isReviewing ? 'none' : 'block';
  userElement.style.display = 'none';
  settingsDisplay.style.display = showPresetDetails ? 'block' : 'none';
  userInput.value = '';
  filePreview.innerHTML = '';
  selectedFiles = [];
  sendBtn.disabled = true;
  enableInput();

  if (window.innerWidth <= smallScreenBreakpoint) {
    sidebar.classList.remove('open');
  }

  if (currentPreset.introduction) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message';
    messageDiv.innerHTML = markdownToHtml(`# ${currentPreset.title}\n\n${currentPreset.introduction}`);
    chatContentContainer.appendChild(messageDiv);
  }
  if (currentPreset.voice) {
    chatForm.style.display = 'none';
    voiceArea.style.display = 'flex';
    speakBtn.textContent = spendLimitReached ? 'Weekly limit reached.' : 'Start Voice Chat';
    speakBtn.disabled = spendLimitReached;
    speakBtn.style.display = 'inline-block';
    restartSpeakBtn.style.display = 'none';
  } else {
    chatForm.style.display = 'flex';
    voiceArea.style.display = 'none';
  }
  isScrolledToBottom = true;
  if (!isReviewing) {
    scrollChatContainer();
  }
}

function startNewChat() {
  const defaultPreset = presets.find(preset => preset.id === 'default');
  if (defaultPreset) {
    applyPreset(defaultPreset, false);
  } else {
    chatContentContainer.innerHTML = '';
    welcomeMessage.style.display = 'block';
    userInput.value = '';
    sendBtn.disabled = true;
    userInput.placeholder = 'Select a tool.';
    const activeChats = document.querySelectorAll('.chat-list-item.active');
    activeChats.forEach(chat => chat.classList.remove('active'));
    if (window.innerWidth <= smallScreenBreakpoint) sidebar.classList.remove('open');
    disableInput();
    settingsDisplay.style.display = 'none';
    switchTab('presets');
  }
}