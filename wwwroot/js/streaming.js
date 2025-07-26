let currentResponseText = '';
let currentResponseElement = null;
let searchStatusElement = null;
let textContainer = null;

async function streamResponse(resp) {

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const text = decoder.decode(value);
    const chunks = text.split(":::");
    for (const chunk of chunks) {
      processChunk(chunk);
    }
  }
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

  switch (chunk) {
    case '[web_search_in_progress]':
    case '[file_search_in_progress]':
    case '[reasoning_in_progress]':
      const inProgressText = chunk === '[web_search_in_progress]' ? 'Searching the web...' : chunk === '[file_search_in_progress]' ? 'Searching documents...' : 'Thinking...';
      searchStatusElement = document.createElement('div');
      searchStatusElement.className = 'search-container';
      currentResponseElement.appendChild(searchStatusElement);
      searchStatusElement.innerHTML = '<div class="search-in-progress"><span class="material-symbols-rounded">' +
        `${chunk === '[reasoning_in_progress]' ? 'neurology' : 'search'}</span> ${inProgressText}</div>`;
      break;
    case '[web_search_completed]':
    case '[file_search_completed]':
    case '[reasoning_completed]':
      const completedText = chunk === '[web_search_completed]' ? 'Searched the web.' : chunk === '[file_search_in_progress]' ? 'Searched documents.' : 'Finished thinking.';
      searchStatusElement.innerHTML = `<div class="search-completed"><span class="material-symbols-rounded">check_circle</span> ${completedText}</div>`;
      textContainer = null;
      break;``
    case '[spend_limit_reached]':
      spendLimitReached = true;
      break;
    case '[flagged]':
      showStopMessage(currentResponseElement, stopCommands.find(o => o.token === '[FLAG]'));
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

      if (!textContainer) {
        textContainer = document.createElement('div');
        currentResponseElement.appendChild(textContainer);
        currentResponseText = '';
      }
      currentResponseText += chunk;

      const stopCommand = stopCommands.find(({ token }) => currentResponseText.includes(token));
      if (stopCommand) {
        showStopMessage(currentResponseElement, stopCommand);
      } else {
        textContainer.innerHTML = markdownToHtml(currentResponseText);
      }
      break;
  }

  scrollChatContainer();
}