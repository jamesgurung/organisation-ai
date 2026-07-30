let currentResponseText = '';
let currentResponseElement = null;
let searchStatusElement = null;
let reasoningStatusElement = null;
let reasoningSummaryText = '';
let reasoningSummaryIndex = null;
let reasoningSummaryNeedsSeparator = false;
let reasoningCompleted = false;
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
        await processChunk(buffer);
        buffer = '';
        break;
      }
      if (tokenStart > 0) {
        await processChunk(buffer.substring(0, tokenStart));
        buffer = buffer.substring(tokenStart);
        continue;
      }

      const tokenEnd = buffer.indexOf(':::', 3);
      if (tokenEnd === -1) break;
      await processChunk(buffer.substring(3, tokenEnd));
      buffer = buffer.substring(tokenEnd + 3);
    }
  }
  if (buffer.length > 0) await processChunk(buffer);
  completeReasoningStatus();
}

async function processChunk(chunk) {
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
    if (chunk === '[reasoning_in_progress]') {
      if (reasoningStatusElement) {
        reasoningSummaryNeedsSeparator = reasoningCompleted && reasoningSummaryText.length > 0;
      } else {
        reasoningSummaryText = '';
        reasoningStatusElement = createReasoningStatus();
        currentResponseElement.appendChild(reasoningStatusElement);
      }
      reasoningSummaryIndex = null;
      reasoningCompleted = false;
    } else {
      completeReasoningStatus();
      searchStatusElement = document.createElement('div');
      searchStatusElement.className = 'search-container';
      searchStatusElement.innerHTML = `<div class="search-in-progress"><span class="material-symbols-rounded">${inProgressStatus.icon}</span> ${inProgressStatus.text}</div>`;
      currentResponseElement.appendChild(searchStatusElement);
    }
    textContainer = null;
  } else if (completedText) {
    if (chunk === '[reasoning_completed]') {
      reasoningCompleted = true;
    } else {
      const statusElement = searchStatusElement?.querySelector('.search-in-progress, .search-completed');
      if (statusElement) {
        statusElement.className = 'search-completed';
        statusElement.innerHTML = `<span class="material-symbols-rounded">check_circle</span> ${completedText}`;
      }
    }
    textContainer = null;
  } else if (chunk.startsWith('[reasoning_summary=')) {
    if (!reasoningStatusElement) {
      reasoningStatusElement = createReasoningStatus();
      currentResponseElement.appendChild(reasoningStatusElement);
    }
    const prefix = '[reasoning_summary=';
    const separatorIndex = chunk.indexOf(';', prefix.length);
    const summaryIndex = Number(chunk.substring(prefix.length, separatorIndex));
    const encodedDelta = chunk.substring(separatorIndex + 1, chunk.length - 1);
    const bytes = Uint8Array.from(atob(encodedDelta), character => character.charCodeAt(0));
    if (reasoningSummaryIndex !== null && reasoningSummaryIndex !== summaryIndex)
      reasoningSummaryNeedsSeparator = reasoningSummaryText.length > 0;
    if (reasoningSummaryNeedsSeparator) {
      reasoningSummaryText += '\n\n';
      reasoningSummaryNeedsSeparator = false;
    }
    reasoningSummaryIndex = summaryIndex;
    reasoningSummaryText += new TextDecoder().decode(bytes);
    let summaryElement = reasoningStatusElement.querySelector('.reasoning-summary');
    if (!summaryElement) {
      summaryElement = document.createElement('div');
      summaryElement.className = 'reasoning-summary';
      reasoningStatusElement.appendChild(summaryElement);
    }
    await renderMarkdown(summaryElement, reasoningSummaryText);
  } else {
    switch (chunk) {
      case '[spend_limit_reached]':
        spendLimitReached = true;
        break;
      case '[flagged]':
        completeReasoningStatus();
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
          completeReasoningStatus();
          const separatorIndex = chunk.indexOf(';');
          appendImageToCurrentResponse(chunk.substring(7, separatorIndex), chunk.substring(separatorIndex + 1, chunk.length - 1));
          break;
        }
        if (chunk.startsWith('[error=')) {
          completeReasoningStatus();
          currentResponseElement.classList.add('error');
          clearRenderedContent(currentResponseElement);
          currentResponseElement.textContent = chunk.substring(7, chunk.length - 1) || 'Something went wrong. Please try again later.';
          break;
        }

        completeReasoningStatus();
        if (!textContainer) {
          textContainer = document.createElement('div');
          currentResponseElement.appendChild(textContainer);
          currentResponseText = '';
        }
        currentResponseText += chunk;

        const stopCommand = stopCommands.find(({ token }) => currentResponseText.includes(token));
        if (stopCommand) showStopMessage(currentResponseElement, stopCommand);
        else await renderMarkdown(textContainer, currentResponseText);
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

function createReasoningStatus(summary = '', completed = false) {
  const container = document.createElement('div');
  container.className = 'search-container';

  const statusElement = document.createElement('div');
  statusElement.className = completed ? 'search-completed' : 'search-in-progress';
  statusElement.innerHTML = completed
    ? '<span class="material-symbols-rounded">check_circle</span> Finished thinking.'
    : '<span class="material-symbols-rounded">neurology</span> Thinking...';
  container.appendChild(statusElement);

  if (summary) {
    const summaryElement = document.createElement('div');
    summaryElement.className = 'reasoning-summary';
    summaryElement.innerHTML = markdownToHtml(summary);
    container.appendChild(summaryElement);
  }

  return container;
}

function completeReasoningStatus() {
  const statusElement = reasoningStatusElement?.querySelector('.search-in-progress, .search-completed');
  if (!statusElement) return;

  statusElement.className = 'search-completed';
  statusElement.innerHTML = '<span class="material-symbols-rounded">check_circle</span> Finished thinking.';
  reasoningStatusElement = null;
  reasoningSummaryText = '';
  reasoningSummaryIndex = null;
  reasoningSummaryNeedsSeparator = false;
  reasoningCompleted = false;
}
