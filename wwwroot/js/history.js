let activeHistoryController = null;
let activeHistoryChatId = null;
let isResolvingReviews = false;

function cancelHistoryLoad() {
  activeHistoryController?.abort();
  activeHistoryController = null;
  activeHistoryChatId = null;
}

function refreshHistoryUI() {
  historyContainer.innerHTML = '';
  history.forEach(chat => historyContainer.appendChild(createHistoryItem(chat)));
}

function createHistoryItem(conversationEntity) {
  const historyItem = createListItem(conversationEntity.title, () => loadChat(conversationEntity.id, false));
  historyItem.id = `chat-${conversationEntity.id}`;
  historyItem.className = `chat-list-item${conversationEntity.id === currentChatId ? ' active' : ''}`;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-chat';
  deleteBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
  deleteBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await deleteChat(conversationEntity.id);
  });

  historyItem.appendChild(deleteBtn);
  return historyItem;
}

function refreshReviewUI() {
  const activeId = reviewContainer.querySelector('.active')?.id;
  reviewContainer.innerHTML = '';
  reviewItems.forEach(reviewEntity => reviewContainer.appendChild(createReviewItem(reviewEntity)));
  if (activeId) document.getElementById(activeId)?.classList.add('active');
  reviewBadge.textContent = reviewItems.length;
  reviewBadge.style.display = reviewItems.length > 0 ? 'block' : 'none';
  if (reviewItems.length > 0)
    reviewContainer.appendChild(createListItem('Clear review queue', clearReviewQueue));
}

function createReviewItem(reviewEntity) {
  const reviewItem = createListItem(reviewEntity.title, () => loadChat(reviewEntity.id, reviewItem.dataset.user, reviewItem.dataset.group));
  reviewItem.id = `review-${reviewEntity.id}`;
  reviewItem.dataset.user = reviewEntity.user;
  reviewItem.dataset.group = reviewEntity.group;
  return reviewItem;
}

async function loadChat(chatId, user, group) {
  cancelHistoryLoad();
  if (!user) replaceSelectionQuery('conversation', chatId);
  else replaceSelectionQuery();
  const controller = new AbortController();
  activeHistoryController = controller;
  activeHistoryChatId = chatId;
  resetStreamingState();
  clearRenderedContent(chatContentContainer);
  welcomeMessage.style.display = 'none';
  document.querySelectorAll('.chat-list-item.active').forEach(chat => chat.classList.remove('active'));
  document.getElementById(`${user ? 'review' : 'chat'}-${chatId}`)?.classList.add('active');
  let conversation;
  try {
    const response = await fetch(group ? `/api/conversations/${group}/${chatId}` : `/api/conversations/${chatId}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Conversation request failed with status ${response.status}.`);
    conversation = await response.json();
  } catch (error) {
    if (error.name === 'AbortError' || activeHistoryController !== controller) return;
    activeHistoryController = null;
    activeHistoryChatId = null;
    currentChatId = null;
    document.getElementById(`${user ? 'review' : 'chat'}-${chatId}`)?.classList.remove('active');
    addErrorMessageToUI();
    return;
  }
  if (activeHistoryController !== controller) return;
  activeHistoryController = null;
  activeHistoryChatId = null;
  applyPreset(conversation.preset, !!user, false);
  currentChatId = chatId;
  document.getElementById(`${user ? 'review' : 'chat'}-${chatId}`)?.classList.add('active');
  conversation.turns.forEach(turn => addMessageToUI(turn, !user));
  if (!user) applyMaxTurnsLimit();
  if (window.innerWidth <= 768) sidebar.classList.remove('open');
  if (conversation.preset.voice) {
    speakBtn.style.display = 'none';
    restartSpeakBtn.style.display = 'inline-block';
  }
  if (user) {
    userElement.textContent = `User: ${user}`;
    userElement.style.display = 'block';
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'resolve';
    resolveBtn.textContent = 'Resolve';
    resolveBtn.disabled = isResolvingReviews;
    resolveBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await resolveReviewItem(group);
    });
    chatContentContainer.appendChild(resolveBtn);
    chatContainer.scrollTop = 0;
  }
}

async function deleteChat(chatId) {
  const resetChat = chatId === currentChatId || chatId === activeHistoryChatId;
  if (chatId === activeHistoryChatId) cancelHistoryLoad();
  if (resetChat) startNewChat();
  document.getElementById(`chat-${chatId}`).remove();
  const index = history.findIndex(chat => chat.id === chatId);
  if (index !== -1) history.splice(index, 1);
  await fetch(`/api/conversations/${chatId}`, { method: 'DELETE', headers });
}

function moveCurrentChatToTop() {
  const chatItem = document.getElementById(`chat-${currentChatId}`);
  if (chatItem && chatItem !== historyContainer.firstChild)
    historyContainer.prepend(chatItem);
}

async function resolveReviewItem(group) {
  if (isResolvingReviews) return;
  isResolvingReviews = true;
  const chatId = currentChatId;
  document.querySelector('.resolve').disabled = true;
  try {
    const response = await fetch(`/api/conversations/${group}/${chatId}/resolve`, { method: 'POST', headers });
    if (!response.ok) throw new Error('Review resolution failed.');
    const index = reviewItems.findIndex(item => item.id === chatId && item.group === group);
    const wasActive = reviewContainer.querySelector('.active')?.id === `review-${chatId}`;
    if (index !== -1) reviewItems.splice(index, 1);
    const nextItem = reviewItems[index] || reviewItems[index - 1];
    refreshReviewUI();
    if (!wasActive) return;
    if (nextItem) {
      await loadChat(nextItem.id, nextItem.user, nextItem.group);
      return;
    }
    switchTab('presets');
    startNewChat();
  } catch {
    alert('Failed to resolve review item.');
  } finally {
    isResolvingReviews = false;
    const resolveBtn = document.querySelector('.resolve');
    if (resolveBtn) resolveBtn.disabled = false;
  }
}

async function clearReviewQueue() {
  if (isResolvingReviews || reviewItems.length === 0) return;
  isResolvingReviews = true;
  const resolveBtn = document.querySelector('.resolve');
  if (resolveBtn) resolveBtn.disabled = true;
  try {
    const items = [...reviewItems];
    const results = await Promise.allSettled(items.map(async item => {
      const response = await fetch(`/api/conversations/${item.group}/${item.id}/resolve`, { method: 'POST', headers });
      if (!response.ok) throw new Error('Review resolution failed.');
    }));
    const activeId = reviewContainer.querySelector('.active')?.id;
    let resetChat = false;
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const item = items[index];
      if (activeId === `review-${item.id}`) resetChat = true;
      reviewItems.splice(reviewItems.indexOf(item), 1);
    });
    refreshReviewUI();
    if (resetChat) {
      switchTab('presets');
      startNewChat();
    }
    if (results.some(result => result.status === 'rejected'))
      alert('Failed to resolve some review items. Please try again.');
  } finally {
    isResolvingReviews = false;
    const resolveBtn = document.querySelector('.resolve');
    if (resolveBtn) resolveBtn.disabled = false;
  }
}
