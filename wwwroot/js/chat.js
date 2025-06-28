let currentChatId = null;
let selectedFiles = [];

async function handleSubmit(e) {
  e.preventDefault();
  const message = userInput.value.trim().replace(/\r\n/g, '\n');
  userInput.value = message;
  const files = selectedFiles;
  if (message.length === 0) return;

  const userTurn = { role: 'user', text: message, timestamp: new Date().toISOString() };

  if (selectedFiles.length > 0) {
    const processFilesByType = (fileArray, isImage) => {
      return Promise.all(fileArray.map(async file => {
        const content = await readFileAsBase64(file);
        return isImage ? { content, type: file.type } : { content, filename: file.name };
      }));
    };
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const otherFiles = files.filter(file => !file.type.startsWith('image/'));
    if (imageFiles.length > 0) userTurn.images = await processFilesByType(imageFiles, true);
    if (otherFiles.length > 0) userTurn.files = await processFilesByType(otherFiles, false);
  }
  if (currentChatId !== null) moveCurrentChatToTop();
  addMessageToUI(userTurn);
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;
  filePreview.innerHTML = '';
  selectedFiles = [];
  disableInput();
  showTypingIndicator();
  await chat(message, files);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result.split(',')[1]); };
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

async function chat(prompt, files) {
  try {
    currentResponseText = '';
    currentResponseElement = null;
    searchStatusElement = null;
    const originalInstanceId = instanceId;
    
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('instanceId', originalInstanceId);
    if (currentChatId === null) formData.append('presetId', currentPreset.id);
    else formData.append('id', currentChatId);
    if (files) files.forEach(file => { formData.append('files', file); });

    const response = await fetch('/api/chat', { method: 'POST', headers, body: formData });
    removeTypingIndicator();
    
    if (response.ok) {
      const data = await response.json();
      spendLimitReached = data.spendLimitReached;
      if (originalInstanceId !== instanceId) return;
      if (currentChatId === null) {
        currentChatId = data.id;
        const conversationEntity = { id: currentChatId, title: data.title };
        history.unshift(conversationEntity);
        const historyItem = createHistoryItem(conversationEntity);
        historyContainer.insertBefore(historyItem, historyContainer.firstChild);
      }
      if (currentResponseElement === null) {
        currentResponseElement = addMessageToUI(data.content);
      } else {
        wrapTables(currentResponseElement);
      }
      if (chatContentContainer.querySelectorAll('.user-message').length >= 6) {
        longChatWarning.style.display = 'block';
        scrollChatContainer();
      }
      const classList = currentResponseElement.classList;
      if (!classList.contains('stop') && !classList.contains('error')) enableInput();
    } else {
      addErrorMessageToUI();
    }
  } catch (error) {
    removeTypingIndicator();
    addErrorMessageToUI();
  }
}

function addMessageToUI(turn) {
  welcomeMessage.style.display = 'none';

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${turn.role}-message`;

  if ((turn.images?.length ?? 0) > 0 || (turn.files?.length ?? 0) > 0) {
    const filesContainer = document.createElement('div');
    filesContainer.className = 'message-files';

    if (turn.images && turn.images.length > 0) {
      turn.images.forEach(image => {
        const fileElement = document.createElement('div');
        fileElement.className = 'message-file';

        const img = document.createElement('img');
        img.src = `data:${image.type};base64,${image.content}`;
        img.className = 'message-image';
        img.alt = 'Image';

        const downloadLink = document.createElement('a');
        downloadLink.href = img.src;
        downloadLink.download = `image.${image.type.split('/')[1]}`;
        downloadLink.appendChild(img);

        fileElement.appendChild(downloadLink);
        filesContainer.appendChild(fileElement);
      });
    }

    if (turn.files && turn.files.length > 0) {
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
      textDiv.innerHTML = markdownToHtml(turn.text);
      wrapTables(textDiv);
      messageDiv.appendChild(textDiv);
    }
  }

  if (turn.timestamp) {
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    const date = new Date(turn.timestamp);
    const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const formattedDate = date.toLocaleString('en-GB', options);
    timestampDiv.textContent = formattedDate;
    messageDiv.appendChild(timestampDiv);
  }

  chatContentContainer.appendChild(messageDiv);
  scrollChatContainer();
  return messageDiv;
}

function showStopMessage(messageDiv, stopCommand) {
  messageDiv.classList.add(stopCommand.token === '[FLAG]' ? 'error' : 'stop');
  messageDiv.innerHTML = '';
  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  textDiv.innerHTML = markdownToHtml(stopCommand.message);

  messageDiv.appendChild(textDiv);
  scrollChatContainer();
  disableInput();
  userInput.placeholder = 'Please start over.';
}

function addErrorMessageToUI() {
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
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  const validFiles = files.filter(file => allowedTypes.includes(file.type) &&
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
  if (!file.type.startsWith('image/')) {
    return file;
  }

  const img = new Image();
  await new Promise(resolve => { img.onload = resolve; img.src = URL.createObjectURL(file); });

  const MAX_SHORT = 768;
  const MAX_LONG = 2000;
  
  let width = img.width;
  let height = img.height;
  
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  
  if (shortSide <= MAX_SHORT && longSide <= MAX_LONG) {
    URL.revokeObjectURL(img.src);
    return file;
  }
  
  const ratio = Math.min(MAX_SHORT / shortSide, MAX_LONG / longSide);
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
  if (isUser) indicator.className = 'user';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    indicator.appendChild(dot);
  }
  chatContentContainer.appendChild(indicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator(isUser) {
  const indicator = document.getElementById('typing-indicator');
  if (indicator && (!isUser || indicator.className === 'user')) {
    indicator.remove();
  }
}