function refreshHistoryUI() {
  historyContainer.innerHTML = '';
  history.forEach(chat => {
    const historyItem = createHistoryItem(chat);
    historyContainer.appendChild(historyItem);
  });
}

function createHistoryItem(conversationEntity) {
  const historyItem = document.createElement('div');
  historyItem.id = `chat-${conversationEntity.id}`;
  historyItem.className = `chat-list-item${conversationEntity.id === currentChatId ? ' active' : ''}`;
  historyItem.tabIndex = 0;

  const textDiv = document.createElement('div');
  textDiv.className = 'chat-list-item-text';
  textDiv.textContent = conversationEntity.title;
  historyItem.appendChild(textDiv);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-chat';
  deleteBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
  deleteBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await deleteChat(conversationEntity.id);
  });

  historyItem.appendChild(deleteBtn);
  historyItem.addEventListener('click', async () => await loadChat(conversationEntity.id, false));
  historyItem.addEventListener('keydown', async (e) => {
    if (e.target === historyItem && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      await loadChat(conversationEntity.id, false);
    }
  });
  return historyItem;
}

function refreshReviewUI() {
  reviewContainer.innerHTML = '';
  reviewItems.forEach(reviewEntity => {
    const reviewItem = createReviewItem(reviewEntity);
    reviewContainer.appendChild(reviewItem);
  });
}

function createReviewItem(reviewEntity) {
  const reviewItem = document.createElement('div');
  reviewItem.id = `review-${reviewEntity.id}`;
  reviewItem.dataset.user = reviewEntity.user;
  reviewItem.dataset.group = reviewEntity.group;
  reviewItem.className = 'chat-list-item';
  reviewItem.tabIndex = 0;

  const textDiv = document.createElement('div');
  textDiv.className = 'chat-list-item-text';
  textDiv.textContent = reviewEntity.title;
  reviewItem.appendChild(textDiv);

  reviewItem.addEventListener('click', async () => await loadChat(reviewEntity.id, reviewItem.dataset.user, reviewItem.dataset.group));
  reviewItem.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      await loadChat(reviewEntity.id, reviewItem.dataset.user, reviewItem.dataset.group);
    }
  });
  return reviewItem;
}

async function loadChat(chatId, user, group) {
  chatContentContainer.innerHTML = '';
  welcomeMessage.style.display = 'none';
  document.querySelectorAll('.chat-list-item.active').forEach(chat => chat.classList.remove('active'));
  document.getElementById(`${user ? 'review' : 'chat'}-${chatId}`)?.classList.add('active');
  const response = await fetch(group ? `/api/conversations/${group}/${chatId}` : `/api/conversations/${chatId}`);
  const conversation = await response.json();
  applyPreset(conversation.preset, !!user);
  currentChatId = chatId;
  document.getElementById(`${user ? 'review' : 'chat'}-${chatId}`)?.classList.add('active');
  conversation.turns.forEach(turn => { addMessageToUI(turn); });
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
    resolveBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await resolveReviewItem(group);
    });
    chatContentContainer.appendChild(resolveBtn);
    chatContainer.scrollTop = 0;
  }
}

async function deleteChat(chatId) {
  document.getElementById(`chat-${chatId}`).remove();
  const index = history.findIndex(chat => chat.id === chatId);
  if (index !== -1) history.splice(index, 1);
  await fetch(`/api/conversations/${chatId}`, { method: 'DELETE', headers });
  if (chatId === currentChatId) startNewChat();
}

function moveCurrentChatToTop() {
  const chatItem = document.getElementById(`chat-${currentChatId}`);
  if (chatItem && chatItem !== historyContainer.firstChild) {
    historyContainer.prepend(chatItem);
  }
}

async function resolveReviewItem(group) {
  document.querySelector('.resolve').disabled = true;
  const resp = await fetch(`/api/conversations/${group}/${currentChatId}/resolve`, { method: 'POST', headers });
  if (!resp.ok) {
    alert('Failed to resolve review item.');
    return;
  }
  const reviewItem = document.getElementById(`review-${currentChatId}`);
  const nextItem = reviewItem.nextElementSibling || reviewItem.previousElementSibling;
  reviewItem.remove();
  if (nextItem) {
    const nextId = nextItem.id.replace('review-', '');
    reviewBadge.textContent = parseInt(reviewBadge.textContent, 10) - 1;
    await loadChat(nextId, nextItem.dataset.user, nextItem.dataset.group);
  } else {
    reviewBadge.style.display = 'none';
    switchTab('presets');
    startNewChat();
  }
}