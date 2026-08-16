let currentChatId = null;
let selectedFiles = [];
const allowedFileTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const maxShortImageSide = 768;
const maxLongImageSide = 2000;

async function handleSubmit(e) {
  e.preventDefault();
  if (activeHistoryController) return;
  if (applyMaxTurnsLimit()) return;
  const message = userInput.value.trim().replace(/\r\n/g, '\n');
  userInput.value = message;
  const files = selectedFiles;
  if (message.length === 0) return;
  const submitGeneration = streamingGeneration;

  const userTurn = { role: 'user', text: message, timestamp: new Date().toISOString() };

  if (files.length > 0) {
    const processFilesByType = (fileArray, isImage) =>
      Promise.all(fileArray.map(async file => {
        const content = await readFileAsBase64(file);
        return isImage ? { content, type: file.type } : { content, filename: file.name };
      }));
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const otherFiles = files.filter(file => !file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      userTurn.images = await processFilesByType(imageFiles, true);
      if (submitGeneration !== streamingGeneration) return;
    }
    if (otherFiles.length > 0) {
      userTurn.files = await processFilesByType(otherFiles, false);
      if (submitGeneration !== streamingGeneration) return;
    }
  }
  if (currentChatId !== null) moveCurrentChatToTop();
  addMessageToUI(userTurn);
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;
  filePreview.innerHTML = '';
  selectedFiles = [];
  resetStreamingState();
  disableInput();
  showTypingIndicator();
  await chat(message, files);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function disableInput() {
  userInput.disabled = true;
  sendBtn.disabled = true;
  fileLabel.style.opacity = '0.5';
  fileLabel.style.pointerEvents = 'none';
}

function enableInput() {
  if (spendLimitReached) {
    userInput.placeholder = 'Weekly limit reached.';
    disableInput();
    return;
  }
  userInput.disabled = false;
  userInput.placeholder = 'Type your message here...';
  fileLabel.style.opacity = '1';
  fileLabel.style.pointerEvents = 'auto';
  focusInput();
}

function applyMaxTurnsLimit() {
  const maxTurns = currentPreset?.maxTurns;
  if (currentPreset?.voice || !Number.isInteger(maxTurns) || maxTurns <= 0 ||
    chatContentContainer.querySelectorAll('.user-message').length < maxTurns)
    return false;

  longChatWarning.style.display = 'none';
  maxTurnsWarning.style.display = 'block';
  disableInput();
  return true;
}

async function chat(prompt, files) {
  const controller = new AbortController();
  const generation = streamingGeneration;
  try {
    currentStreamController = controller;

    const formData = new FormData();
    formData.append('prompt', prompt);
    if (currentChatId === null) formData.append('presetId', currentPreset.id);
    else formData.append('id', currentChatId);
    if (files) files.forEach(file => { formData.append('files', file); });

    const response = await fetch('/api/chat', { method: 'POST', headers, body: formData, signal: controller.signal });
    
    if (response.ok) {
      await streamResponse(response, generation);
      if (currentStreamController !== controller) return;
      wrapTables(currentResponseElement);
      const classList = currentResponseElement.classList;
      if (currentResponseMarkdown && !classList.contains('stop') && !classList.contains('error'))
        addResponseCopyButton(currentResponseElement, currentResponseMarkdown, getCurrentResponseActivities());
      const maxTurnsReached = applyMaxTurnsLimit();
      if (!maxTurnsReached && chatContentContainer.querySelectorAll('.user-message').length >= 6) {
        longChatWarning.style.display = 'block';
        scrollChatContainer();
      }
      if (!maxTurnsReached && !classList.contains('stop') && !classList.contains('error')) enableInput();
    } else {
      removeTypingIndicator();
      clearActivityTimers(true);
      addErrorMessageToUI();
    }
  } catch (error) {
    if (currentStreamController !== controller) return;
    removeTypingIndicator();
    clearActivityTimers(true);
    if (error.name === 'AbortError') return;
    addErrorMessageToUI();
  } finally {
    if (currentStreamController === controller) currentStreamController = null;
  }
}

function addMessageToUI(turn, scrollAfterRender = true) {
  welcomeMessage.style.display = 'none';

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${turn.role}-message`;
  let textContent = null;
  let copyMarkdown = '';
  let activityRenderPromise = Promise.resolve();

  if (turn.role === 'assistant' && turn.activities?.length)
    activityRenderPromise = appendStoredActivities(messageDiv, turn.activities);

  if ((turn.images?.length ?? 0) > 0 || (turn.files?.length ?? 0) > 0) {
    const filesContainer = document.createElement('div');
    filesContainer.className = 'message-files';

    if (turn.images?.length) {
      turn.images.forEach(image => filesContainer.appendChild(createImageFileElement(image.type, image.content)));
    }

    if (turn.files?.length) {
      turn.files.forEach(file => {
        const fileElement = document.createElement('div');
        fileElement.className = 'message-file';

        const fileIcon = document.createElement('div');
        fileIcon.className = 'file-icon';
        fileIcon.textContent = file.filename.split('.').pop().toUpperCase();

        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = file.filename;

        const downloadLink = document.createElement('a');
        downloadLink.href = `data:application/octet-stream;base64,${file.content}`;
        downloadLink.download = file.filename;
        downloadLink.appendChild(fileIcon);
        downloadLink.appendChild(fileName);

        fileElement.appendChild(downloadLink);
        filesContainer.appendChild(fileElement);
      });
    }
    messageDiv.appendChild(filesContainer);
  }

  if (turn.text) {
    const stopCommand = turn.role === 'assistant' && stopCommands.find(({ token }) => turn.text.includes(token));
    if (stopCommand) {
      showStopMessage(messageDiv, stopCommand);
    } else {
      const textDiv = document.createElement('div');
      textDiv.className = 'message-text';
      messageDiv.appendChild(textDiv);
      textContent = { element: textDiv, markdown: turn.text };
      if (turn.role === 'assistant') copyMarkdown = turn.text;
    }
  }

  if (turn.timestamp) {
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    const date = new Date(turn.timestamp);
    const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    timestampDiv.textContent = date.toLocaleString('en-GB', options);
    messageDiv.appendChild(timestampDiv);
  }

  if (copyMarkdown) addResponseCopyButton(messageDiv, copyMarkdown, turn.activities);

  chatContentContainer.appendChild(messageDiv);
  const renderPromise = Promise.all([
    activityRenderPromise,
    textContent
      ? renderMarkdown(textContent.element, textContent.markdown)
      : Promise.resolve()
  ]);
  renderPromise
    .then(() => wrapTables(messageDiv))
    .then(() => typesetMath(messageDiv.querySelectorAll('[data-math-index]')))
    .then(() => scrollAfterRender && scrollChatContainer());
  scrollChatContainer();
  return messageDiv;
}

function addResponseCopyButton(messageDiv, markdown, activities = []) {
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'response-copy-button';
  copyButton.title = 'Copy response';
  copyButton.setAttribute('aria-label', 'Copy response');

  const icon = document.createElement('span');
  icon.className = 'material-symbols-rounded';
  icon.textContent = 'content_copy';
  icon.setAttribute('aria-hidden', 'true');
  copyButton.appendChild(icon);

  let resetTimeout;
  copyButton.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const escapeMarkdown = value => String(value ?? '')
        .replace(/\s*\r?\n\s*/g, ' ')
        .replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, '\\$1');
      const sourceKeys = new Set();
      const sources = [];
      (activities ?? []).flatMap(activity => activity.sources ?? []).forEach(source => {
        const safeUri = getSafeSourceUri(source.uri);
        const key = safeUri ? `uri:${safeUri}` : `file:${(source.filename || source.title || source.uri || '').toLowerCase()}`;
        if (!key || sourceKeys.has(key)) return;
        sourceKeys.add(key);
        sources.push(safeUri
          ? `* [${escapeMarkdown(source.title || safeUri)}](<${safeUri.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`
          : `* ${source.title && source.title !== source.filename ? `${escapeMarkdown(source.title)}${source.filename ? ' — ' : ''}` : ''}${escapeMarkdown(source.filename || source.uri)}`);
      });
      const copyMarkdown = sources.length > 0 ? `${markdown}\n\n### Sources\n${sources.join('\n')}` : markdown;
      await navigator.clipboard.writeText(copyMarkdown);
    } catch {
      return;
    }

    clearTimeout(resetTimeout);
    icon.textContent = 'check';
    copyButton.classList.add('copy-success');
    copyButton.title = 'Copied';
    copyButton.setAttribute('aria-label', 'Copied');
    resetTimeout = setTimeout(() => {
      icon.textContent = 'content_copy';
      copyButton.classList.remove('copy-success');
      copyButton.title = 'Copy response';
      copyButton.setAttribute('aria-label', 'Copy response');
    }, 1500);
  });

  messageDiv.appendChild(copyButton);
}

document.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') return;
  const message = e.target.closest('.assistant-message');
  document.querySelectorAll('.assistant-message.copy-visible').forEach(element => {
    if (element !== message) element.classList.remove('copy-visible');
  });
  if (message?.querySelector('.response-copy-button')) message.classList.add('copy-visible');
});

function createImageFileElement(type, content) {
  const fileElement = document.createElement('div');
  fileElement.className = 'message-file';

  const img = document.createElement('img');
  img.src = `data:${type};base64,${content}`;
  img.className = 'message-image';
  img.alt = 'Image';

  const downloadLink = document.createElement('a');
  downloadLink.href = img.src;
  downloadLink.download = `image.${type.split('/')[1]}`;
  downloadLink.appendChild(img);
  fileElement.appendChild(downloadLink);
  return fileElement;
}

function showStopMessage(messageDiv, stopCommand) {
  messageDiv.classList.add(stopCommand.token === '[FLAG]' ? 'error' : 'stop');
  const activityList = messageDiv.querySelector(':scope > .activity-list');
  activityList?.remove();
  clearRenderedContent(messageDiv);
  if (activityList) messageDiv.appendChild(activityList);
  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  textDiv.innerHTML = markdownToHtml(stopCommand.message);

  messageDiv.appendChild(textDiv);
  if (messageDiv.isConnected)
    typesetMath(textDiv.querySelectorAll('[data-math-index]')).then(scrollChatContainer);
  scrollChatContainer();
  disableInput();
  userInput.placeholder = 'Please start over.';
}

function addErrorMessageToUI() {
  clearActivityTimers(true);
  welcomeMessage.style.display = 'none';

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant-message error';

  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'material-symbols-rounded';
  iconSpan.textContent = 'error';

  textDiv.appendChild(iconSpan);
  textDiv.appendChild(document.createTextNode('Something went wrong. Please try again later.'));

  messageDiv.appendChild(textDiv);
  chatContentContainer.appendChild(messageDiv);
  scrollChatContainer();
}

async function handleFileSelection(e) {
  const files = Array.from(e.target.files);
  const validFiles = files.filter(file => allowedFileTypes.includes(file.type) &&
    !selectedFiles.some(existing => existing.name === file.name && existing.size === file.size && existing.type === file.type));

  if (validFiles.length === 0) return;

  if (selectedFiles.length + validFiles.length > 3) {
    alert('Maximum 3 files allowed');
    e.target.value = '';
    focusInput();
    return;
  }

  const processedFiles = await Promise.all(validFiles.map(resizeFile));
  selectedFiles = [...selectedFiles, ...processedFiles];
  updateFilePreview();
  e.target.value = '';
  focusInput();
}

function updateFilePreview() {
  filePreview.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const thumbnail = document.createElement('div');
    thumbnail.className = 'file-thumbnail';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      thumbnail.appendChild(img);
    } else if (file.type === 'application/pdf') {
      const pdfIcon = document.createElement('div');
      pdfIcon.className = 'pdf-thumbnail';
      pdfIcon.textContent = 'PDF';
      thumbnail.appendChild(pdfIcon);
    }
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-file';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => {
      selectedFiles = selectedFiles.filter((_, i) => i !== index);
      updateFilePreview();
    });
    thumbnail.appendChild(removeBtn);
    filePreview.appendChild(thumbnail);
  });
}

async function resizeFile(file) {
  if (!file.type.startsWith('image/'))
    return file;

  const img = new Image();
  await new Promise(resolve => { img.onload = resolve; img.src = URL.createObjectURL(file); });

  let width = img.width;
  let height = img.height;

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);

  if (shortSide <= maxShortImageSide && longSide <= maxLongImageSide) {
    URL.revokeObjectURL(img.src);
    return file;
  }

  const ratio = Math.min(maxShortImageSide / shortSide, maxLongImageSide / longSide);
  width = Math.round(width * ratio);
  height = Math.round(height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, file.type, 0.9));
  URL.revokeObjectURL(img.src);
  return new File([blob], file.name, { type: file.type });
}

function showTypingIndicator(isUser) {
  removeTypingIndicator();
  const indicator = document.createElement('div');
  indicator.id = 'typing-indicator';
  if (isUser) {
    indicator.className = 'user';
    for (let i = 0; i < 3; i++) indicator.appendChild(document.createElement('span'));
  } else {
    indicator.className = 'assistant';
    const label = document.createElement('span');
    label.className = 'activity-label';
    label.textContent = 'Waiting';
    const timer = document.createElement('span');
    timer.className = 'activity-timer';
    const chevron = document.createElement('span');
    chevron.className = 'material-symbols-rounded activity-chevron activity-chevron-placeholder';
    chevron.textContent = 'expand_more';
    chevron.setAttribute('aria-hidden', 'true');
    indicator.appendChild(createDriveLoader());
    indicator.appendChild(label);
    indicator.appendChild(timer);
    indicator.appendChild(chevron);
    indicator.timerId = startActivityTimer(timer);
  }
  chatContentContainer.appendChild(indicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator(isUser) {
  const indicator = document.getElementById('typing-indicator');
  if (indicator && (!isUser || indicator.className === 'user')) {
    stopActivityTimer(indicator.timerId);
    indicator.remove();
  }
}
