let currentPreset = null;

function displayPresets() {
  presetsContainer.innerHTML = '';

  const grouped = {};
  presets.forEach(preset => {
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
      const presetItem = createListItem(preset.title, () => applyPreset(preset, false));
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
    settingItemReasoning.title = reasoning ? `Reasoning model (${currentPreset.reasoningEffort} thinking)` : 'Reasoning model';
    settingItemWebSearch.style.display = currentPreset.webSearch ? 'flex' : 'none';
    settingItemDocumentSearch.style.display = currentPreset.vectorStore ? 'flex' : 'none';
    settingItemImageGeneration.style.display = currentPreset.imageModel ? 'flex' : 'none';
    const instructionsDiv = instructionsPopup.querySelector('div');
    instructionsDiv.textContent = currentPreset.instructions;
    instructionsDiv.scrollTop = 0;
  }

  clearRenderedContent(chatContentContainer);
  welcomeMessage.style.display = currentPreset.introduction ? 'none' : 'block';
  document.querySelectorAll('.chat-list-item').forEach(item =>
    item.classList.toggle('active', item.textContent === currentPreset.title && !isReviewing));

  longChatWarning.style.display = 'none';
  maxTurnsWarning.style.display = 'none';
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
    chatContentContainer.appendChild(messageDiv);
    renderMarkdown(messageDiv, `# ${currentPreset.title}\n\n${currentPreset.introduction}`);
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
    return;
  }

  clearRenderedContent(chatContentContainer);
  welcomeMessage.style.display = 'block';
  userInput.value = '';
  sendBtn.disabled = true;
  userInput.placeholder = 'Select a tool.';
  document.querySelectorAll('.chat-list-item.active').forEach(chat => chat.classList.remove('active'));
  if (window.innerWidth <= smallScreenBreakpoint) sidebar.classList.remove('open');
  disableInput();
  settingsDisplay.style.display = 'none';
  switchTab('presets');
}
