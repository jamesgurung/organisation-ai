let currentResponseText = '';
let currentResponseElement = null;
let searchStatusElement = null;
let textContainer = null;
const inProgressStatuses = {
  '[web_search_in_progress]': { text: 'Searching the web...', icon: 'search' },
  '[file_search_in_progress]': { text: 'Searching documents...', icon: 'search' },
  '[reasoning_in_progress]': { text: 'Thinking...', icon: 'neurology' },
  '[image_generation_in_progress]': { text: 'Generating image (this may take several minutes)...', icon: 'image' }
};
const completedStatusText = {
  '[web_search_completed]': 'Searched the web.',
  '[file_search_completed]': 'Searched documents.',
  '[reasoning_completed]': 'Finished thinking.',
  '[image_generation_completed]': 'Generated image.'
};

async function streamResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });

    while (buffer.length > 0) {
      const tokenStart = buffer.indexOf(':::[');
      if (tokenStart === -1) {
        processChunk(buffer);
        buffer = '';
        break;
      }
      if (tokenStart > 0) {
        processChunk(buffer.substring(0, tokenStart));
        buffer = buffer.substring(tokenStart);
        continue;
      }

      const tokenEnd = buffer.indexOf(':::', 3);
      if (tokenEnd === -1) break;
      processChunk(buffer.substring(3, tokenEnd));
      buffer = buffer.substring(tokenEnd + 3);
    }
  }
  if (buffer.length > 0) processChunk(buffer);
}

function processChunk(chunk) {
  if (chunk.length === 0) return;

  if (!currentResponseElement) {
    removeTypingIndicator();
    currentResponseElement = document.createElement('div');
    currentResponseElement.className = 'message assistant-message';
    chatContentContainer.appendChild(currentResponseElement);
    textContainer = null;
  }

  const inProgressStatus = inProgressStatuses[chunk];
  const completedText = completedStatusText[chunk];
  if (inProgressStatus) {
    searchStatusElement = document.createElement('div');
    searchStatusElement.className = 'search-container';
    searchStatusElement.innerHTML = `<div class="search-in-progress"><span class="material-symbols-rounded">${inProgressStatus.icon}</span> ${inProgressStatus.text}</div>`;
    currentResponseElement.appendChild(searchStatusElement);
  } else if (completedText) {
    if (searchStatusElement)
      searchStatusElement.innerHTML = `<div class="search-completed"><span class="material-symbols-rounded">check_circle</span> ${completedText}</div>`;
    textContainer = null;
  } else {
    switch (chunk) {
      case '[spend_limit_reached]':
        spendLimitReached = true;
        break;
      case '[flagged]':
        showStopMessage(currentResponseElement, stopCommands.find(o => o.token === '[FLAG]'));
        break;
      case '[heartbeat]':
        break;
      default:
        if (chunk.startsWith('[conversation=')) {
          currentChatId = chunk.substring(14, 50);
          const conversationEntity = { id: currentChatId, title: chunk.substring(51, chunk.length - 1) };
          history.unshift(conversationEntity);
          const historyItem = createHistoryItem(conversationEntity);
          historyContainer.insertBefore(historyItem, historyContainer.firstChild);
          break;
        }
        if (chunk.startsWith('[image=')) {
          const separatorIndex = chunk.indexOf(';');
          appendImageToCurrentResponse(chunk.substring(7, separatorIndex), chunk.substring(separatorIndex + 1, chunk.length - 1));
          break;
        }
        if (chunk.startsWith('[error=')) {
          currentResponseElement.classList.add('error');
          currentResponseElement.textContent = chunk.substring(7, chunk.length - 1) || 'Something went wrong. Please try again later.';
          break;
        }

        if (!textContainer) {
          textContainer = document.createElement('div');
          currentResponseElement.appendChild(textContainer);
          currentResponseText = '';
        }
        currentResponseText += chunk;

        const stopCommand = stopCommands.find(({ token }) => currentResponseText.includes(token));
        if (stopCommand) showStopMessage(currentResponseElement, stopCommand);
        else textContainer.innerHTML = markdownToHtml(currentResponseText);
        break;
    }
  }

  scrollChatContainer();
}

function appendImageToCurrentResponse(type, content) {
  let filesContainer = currentResponseElement.querySelector('.message-files');
  if (!filesContainer) {
    filesContainer = document.createElement('div');
    filesContainer.className = 'message-files';
    currentResponseElement.appendChild(filesContainer);
  }

  filesContainer.appendChild(createImageFileElement(type, content));
}
