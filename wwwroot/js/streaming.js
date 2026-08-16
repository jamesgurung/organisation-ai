let currentResponseMarkdown = '';
let currentResponseElement = null;
let currentActivityList = null;
let textContainer = null;
let currentStreamController = null;
let currentStreamReader = null;
let activityElementIndex = 0;
let streamingGeneration = 0;
let activitiesCollapsedForOutput = false;
const currentResponseActivities = new Map();
const activityTimerIds = new Set();
const activityLabels = {
  reasoning: { active: 'Thinking', completed: 'Thought' },
  web_search: { active: 'Searching the web', completed: 'Searched the web' },
  file_search: { active: 'Searching documents', completed: 'Searched documents' },
  image_generation: { active: 'Generating image', completed: 'Generated image' }
};

function getSafeSourceUri(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function getActivitySourceKey(source) {
  const safeUri = getSafeSourceUri(source.uri);
  return safeUri
    ? `uri:${safeUri}`
    : `file:${source.filename || source.title || source.uri || ''}`.toLowerCase();
}

function appendUniqueActivitySources(activity, sources) {
  const sourceKeys = new Set(activity.sources.map(getActivitySourceKey));
  for (const source of sources ?? []) {
    const key = getActivitySourceKey(source);
    if (sourceKeys.has(key)) continue;
    sourceKeys.add(key);
    activity.sources.push(source);
  }
}

function combineAdjacentActivities(activities) {
  const combined = [];
  for (const activity of activities) {
    let current = combined.at(-1);
    if (!current || current.kind !== activity.kind) {
      current = {
        id: activity.id,
        kind: activity.kind,
        durationMs: 0,
        summary: '',
        sources: []
      };
      combined.push(current);
    }

    current.durationMs += activity.durationMs ?? 0;
    if (activity.summary)
      current.summary += `${current.summary ? '\n\n' : ''}${activity.summary}`;
    appendUniqueActivitySources(current, activity.sources);
  }
  return combined;
}

function formatActivityDuration(durationMs) {
  const seconds = Math.max(0, durationMs) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

function createDriveLoader() {
  const loader = document.createElement('span');
  loader.className = 'drive-loader';
  loader.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 9; index++) {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const pixel = document.createElement('span');
    pixel.style.setProperty('--drive-delay', `${(column + Math.abs(row - 1)) * 90}ms`);
    loader.appendChild(pixel);
  }
  return loader;
}

function startActivityTimer(element, startedAt = performance.now()) {
  const update = () => { element.textContent = formatActivityDuration(performance.now() - startedAt); };
  update();
  const timerId = setInterval(update, 100);
  activityTimerIds.add(timerId);
  return timerId;
}

function stopActivityTimer(timerId) {
  if (timerId === null || timerId === undefined) return;
  clearInterval(timerId);
  activityTimerIds.delete(timerId);
}

function clearActivityTimers(interrupt = false) {
  activityTimerIds.forEach(clearInterval);
  activityTimerIds.clear();
  new Set(currentResponseActivities.values()).forEach(entry => {
    entry.timerId = null;
    if (!interrupt || !entry.active) return;
    entry.active = false;
    entry.activeIds.clear();
    entry.interrupted = true;
    updateActivityHeader(entry);
    if (!entry.manuallyToggled) setActivityExpanded(entry, false);
    entry.renderPromise = renderActivityDetails(entry);
  });
}

function setActivityExpanded(entry, expanded) {
  entry.expanded = expanded;
  entry.button.setAttribute('aria-expanded', String(expanded));
  entry.details.setAttribute('aria-hidden', String(!expanded));
  entry.details.inert = !expanded;
  entry.element.classList.toggle('expanded', expanded);
}

function updateActivityDisclosure(entry, hasDetails) {
  const gainedDetails = hasDetails && !entry.hasDetails;
  entry.hasDetails = hasDetails;
  entry.button.disabled = !hasDetails;
  entry.chevron.classList.toggle('activity-chevron-placeholder', !hasDetails);
  if (!hasDetails) setActivityExpanded(entry, false);
  else if (gainedDetails && entry.active && !entry.manuallyToggled) setActivityExpanded(entry, true);
}

function collapseActivitiesForOutput() {
  if (activitiesCollapsedForOutput) return;
  activitiesCollapsedForOutput = true;
  new Set(currentResponseActivities.values()).forEach(entry => {
    if (!entry.active && !entry.manuallyToggled) setActivityExpanded(entry, false);
  });
}

function createActivityElement(activity, active = false) {
  const element = document.createElement('div');
  element.className = `activity-item${active ? ' active activity-stream-in' : ' completed'}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'activity-header';

  const activityIndex = ++activityElementIndex;
  const detailsId = `activity-details-${activityIndex}`;
  const labelId = `activity-label-${activityIndex}`;
  button.setAttribute('aria-controls', detailsId);

  const loader = createDriveLoader();
  const label = document.createElement('span');
  label.id = labelId;
  label.className = 'activity-label';
  label.setAttribute('aria-live', 'polite');
  const timer = document.createElement('span');
  timer.className = 'activity-timer';
  const chevron = document.createElement('span');
  chevron.className = 'material-symbols-rounded activity-chevron';
  chevron.textContent = 'expand_more';
  chevron.setAttribute('aria-hidden', 'true');

  button.appendChild(loader);
  button.appendChild(label);
  button.appendChild(timer);
  button.appendChild(chevron);

  const details = document.createElement('div');
  details.id = detailsId;
  details.className = 'activity-details';
  details.setAttribute('role', 'region');
  details.setAttribute('aria-labelledby', labelId);
  const detailsInner = document.createElement('div');
  detailsInner.className = 'activity-details-inner';
  details.appendChild(detailsInner);

  element.appendChild(button);
  element.appendChild(details);

  const entry = {
    activity: {
      id: activity.id,
      kind: activity.kind,
      durationMs: activity.durationMs ?? 0,
      summary: activity.summary ?? '',
      sources: []
    },
    element,
    button,
    label,
    timer,
    chevron,
    details,
    detailsInner,
    summaryElement: null,
    live: active,
    active,
    interrupted: false,
    expanded: false,
    hasDetails: false,
    manuallyToggled: false,
    timerId: null,
    activeIds: new Set(active ? [activity.id] : []),
    lastSummaryActivityId: null
  };
  appendUniqueActivitySources(entry.activity, activity.sources);

  button.addEventListener('click', () => {
    entry.manuallyToggled = true;
    setActivityExpanded(entry, !entry.expanded);
  });

  setActivityExpanded(entry, false);
  updateActivityHeader(entry);
  if (active) entry.timerId = startActivityTimer(timer);
  entry.renderPromise = renderActivityDetails(entry);
  return entry;
}

function updateActivityHeader(entry) {
  const labels = activityLabels[entry.activity.kind] ?? { active: 'Working', completed: 'Completed' };
  entry.label.textContent = entry.interrupted ? `${labels.active} interrupted` : entry.active ? labels.active : labels.completed;
  if (!entry.active && !entry.interrupted) entry.timer.textContent = formatActivityDuration(entry.activity.durationMs);
  entry.element.classList.toggle('active', entry.active);
  entry.element.classList.toggle('completed', !entry.active && !entry.interrupted);
  entry.element.classList.toggle('interrupted', entry.interrupted);
}

async function renderActivityDetails(entry) {
  const { kind, summary, sources } = entry.activity;
  const hasDetails = kind === 'reasoning'
    ? Boolean(summary.trim())
    : (kind === 'web_search' || kind === 'file_search') && sources.length > 0;
  updateActivityDisclosure(entry, hasDetails);
  if (!hasDetails) {
    clearRenderedContent(entry.detailsInner);
    entry.summaryElement = null;
    return;
  }

  if (kind === 'reasoning') {
    if (!entry.summaryElement) {
      clearRenderedContent(entry.detailsInner);
      entry.summaryElement = document.createElement('div');
      entry.summaryElement.className = 'activity-summary';
      entry.detailsInner.appendChild(entry.summaryElement);
    }
    await renderMarkdown(entry.summaryElement, summary, entry.active);
    return;
  }

  if (kind === 'web_search' || kind === 'file_search') {
    clearRenderedContent(entry.detailsInner);
    const sourceList = document.createElement('div');
    sourceList.className = 'activity-sources';
    sources.forEach((source, index) => {
      const safeUri = getSafeSourceUri(source.uri);
      const row = safeUri ? document.createElement('a') : document.createElement('div');
      row.className = `activity-source${entry.live ? ' activity-stream-in' : ''}`;
      if (entry.live) row.style.animationDelay = `${Math.min(index * 40, 160)}ms`;
      if (safeUri) {
        row.href = safeUri;
        row.target = '_blank';
        row.rel = 'noreferrer';
      }

      const marker = document.createElement('span');
      marker.className = 'activity-source-marker';
      marker.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'activity-source-title';
      title.textContent = source.title || source.filename || source.uri;
      const location = document.createElement('span');
      location.className = 'activity-source-location';
      if (source.filename) location.textContent = source.title === source.filename ? 'File' : source.filename;
      else {
        location.textContent = safeUri ? new URL(safeUri).hostname.replace(/^www\./, '') : 'Link unavailable';
      }

      row.appendChild(marker);
      row.appendChild(title);
      row.appendChild(location);
      sourceList.appendChild(row);
    });
    entry.detailsInner.appendChild(sourceList);
  }
}

function ensureActivityList() {
  ensureCurrentResponseElement();
  if (currentActivityList) return currentActivityList;
  currentActivityList = document.createElement('div');
  currentActivityList.className = 'activity-list';
  currentResponseElement.prepend(currentActivityList);
  return currentActivityList;
}

function ensureCurrentResponseElement() {
  if (currentResponseElement) return currentResponseElement;
  removeTypingIndicator();
  currentResponseElement = document.createElement('div');
  currentResponseElement.className = 'message assistant-message';
  chatContentContainer.appendChild(currentResponseElement);
  return currentResponseElement;
}

async function ensureLiveActivity(activity) {
  let entry = currentResponseActivities.get(activity.id);
  if (entry) return entry;

  entry = Array.from(new Set(currentResponseActivities.values())).at(-1);
  if (entry?.activity.kind === activity.kind) {
    currentResponseActivities.set(activity.id, entry);
    entry.activeIds.add(activity.id);
    if (!entry.active) {
      entry.active = true;
      entry.interrupted = false;
      entry.timerId = startActivityTimer(entry.timer, performance.now() - entry.activity.durationMs);
      updateActivityHeader(entry);
    }
    return entry;
  }

  entry = createActivityElement(activity, true);
  currentResponseActivities.set(activity.id, entry);
  ensureActivityList().appendChild(entry.element);
  await entry.renderPromise;
  return entry;
}

async function processActivityEvent(activityEvent) {
  if (!activityEvent?.id) return;
  let entry = currentResponseActivities.get(activityEvent.id);
  if (activityEvent.event === 'started') {
    await ensureLiveActivity({ id: activityEvent.id, kind: activityEvent.kind });
    return;
  }

  if (!entry) {
    const kind = activityEvent.event === 'summary_delta'
      ? 'reasoning'
      : activityEvent.sources?.some(source => source.filename) ? 'file_search' : 'web_search';
    entry = await ensureLiveActivity({ id: activityEvent.id, kind });
  }

  if (activityEvent.event === 'summary_delta') {
    const delta = activityEvent.delta ?? '';
    if (delta && entry.lastSummaryActivityId !== null && entry.lastSummaryActivityId !== activityEvent.id && entry.activity.summary)
      entry.activity.summary += '\n\n';
    entry.lastSummaryActivityId = activityEvent.id;
    entry.activity.summary += delta;
    await renderActivityDetails(entry);
    return;
  }

  if (activityEvent.event === 'sources') {
    appendUniqueActivitySources(entry.activity, activityEvent.sources);
    await renderActivityDetails(entry);
    return;
  }

  if (activityEvent.event !== 'completed' || !entry.activeIds.delete(activityEvent.id)) return;
  entry.activity.durationMs += activityEvent.durationMs ?? 0;
  if (entry.activeIds.size > 0) return;

  entry.active = false;
  entry.interrupted = false;
  stopActivityTimer(entry.timerId);
  entry.timerId = null;
  updateActivityHeader(entry);
  if (activitiesCollapsedForOutput && !entry.manuallyToggled) setActivityExpanded(entry, false);
  await renderActivityDetails(entry);
}

function appendStoredActivities(container, activities) {
  if (!activities?.length) return Promise.resolve();
  const list = document.createElement('div');
  list.className = 'activity-list';
  container.appendChild(list);
  const renders = combineAdjacentActivities(activities).map(activity => {
    const entry = createActivityElement(activity, false);
    list.appendChild(entry.element);
    return entry.renderPromise;
  });
  return Promise.all(renders);
}

function getCurrentResponseActivities() {
  return Array.from(new Set(currentResponseActivities.values()), entry => entry.activity);
}

function resetStreamingState(abortStream = true) {
  streamingGeneration++;
  if (abortStream) currentStreamController?.abort();
  currentStreamReader?.cancel().catch(() => {});
  currentStreamController = null;
  currentStreamReader = null;
  clearActivityTimers();
  removeTypingIndicator();
  currentResponseActivities.clear();
  activitiesCollapsedForOutput = false;
  currentResponseMarkdown = '';
  currentResponseElement = null;
  currentActivityList = null;
  textContainer = null;
}

async function streamResponse(response, generation) {
  const reader = response.body.getReader();
  currentStreamReader = reader;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (generation !== streamingGeneration) return;
      if (done) {
        buffer += decoder.decode();
        break;
      }
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });

      while (buffer.length > 0) {
        const tokenStart = buffer.indexOf(':::[');
        if (tokenStart === -1) {
          let retainedLength = 0;
          for (let length = 1; length <= Math.min(3, buffer.length); length++) {
            if (':::['.startsWith(buffer.slice(-length))) retainedLength = length;
          }
          const textLength = buffer.length - retainedLength;
          if (textLength > 0) {
            await processChunk(buffer.substring(0, textLength));
            if (generation !== streamingGeneration) return;
            buffer = buffer.substring(textLength);
            continue;
          }
          break;
        }
        if (tokenStart > 0) {
          await processChunk(buffer.substring(0, tokenStart));
          if (generation !== streamingGeneration) return;
          buffer = buffer.substring(tokenStart);
          continue;
        }

        const tokenEnd = buffer.indexOf(':::', 3);
        if (tokenEnd === -1) break;
        await processChunk(buffer.substring(3, tokenEnd), true);
        if (generation !== streamingGeneration) return;
        buffer = buffer.substring(tokenEnd + 3);
      }
    }
    if (buffer.length > 0) {
      await processChunk(buffer);
      if (generation !== streamingGeneration) return;
    }
    if (textContainer && !currentResponseElement.classList.contains('error') && !currentResponseElement.classList.contains('stop'))
      await renderMarkdown(textContainer, currentResponseMarkdown);
  } finally {
    if (generation === streamingGeneration) {
      currentStreamReader = null;
      clearActivityTimers(true);
    }
  }
}

async function processChunk(chunk, framed = false) {
  if (chunk.length === 0) return;
  if (chunk === '[heartbeat]') return;
  ensureCurrentResponseElement();

  if (chunk.startsWith('[text=')) {
    try {
      const encoded = chunk.substring(6, chunk.length - 1);
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await appendResponseText(new TextDecoder().decode(bytes));
    } catch (error) {
      console.error('Invalid text event.', error);
      await appendResponseText(`:::${chunk}:::`);
    }
  } else if (chunk.startsWith('[activity=')) {
    try {
      const encoded = chunk.substring(10, chunk.length - 1);
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await processActivityEvent(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
      console.error('Invalid activity event.', error);
      await appendResponseText(`:::${chunk}:::`);
    }
  } else {
    switch (chunk) {
      case '[spend_limit_reached]':
        spendLimitReached = true;
        break;
      case '[flagged]':
        clearActivityTimers(true);
        showStopMessage(currentResponseElement, stopCommands.find(o => o.token === '[FLAG]'));
        break;
      case '[heartbeat]':
        break;
      default:
        if (chunk.startsWith('[conversation=')) {
          let conversationEntity;
          try {
            const encoded = chunk.substring(14, chunk.length - 1);
            const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
            conversationEntity = JSON.parse(new TextDecoder().decode(bytes));
          } catch {
            conversationEntity = { id: chunk.substring(14, 50), title: chunk.substring(51, chunk.length - 1) };
          }
          currentChatId = conversationEntity.id;
          replaceSelectionQuery('conversation', currentChatId);
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
          clearActivityTimers(true);
          currentResponseElement.classList.add('error');
          if (!textContainer) {
            textContainer = document.createElement('div');
            textContainer.className = 'message-text';
            currentResponseElement.appendChild(textContainer);
          }
          clearRenderedContent(textContainer);
          const encoded = chunk.substring(7, chunk.length - 1);
          try {
            const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
            textContainer.textContent = new TextDecoder().decode(bytes);
          } catch {
            textContainer.textContent = encoded || 'Something went wrong. Please try again later.';
          }
          break;
        }

        await appendResponseText(framed ? `:::${chunk}:::` : chunk);
        break;
    }
  }

  scrollChatContainer();
}

async function appendResponseText(chunk) {
  if (chunk.length > 0) collapseActivitiesForOutput();
  currentResponseMarkdown += chunk;
  if (!textContainer) {
    textContainer = document.createElement('div');
    textContainer.className = 'message-text';
    currentResponseElement.appendChild(textContainer);
  }

  const stopCommand = stopCommands.find(({ token }) => currentResponseMarkdown.includes(token));
  if (stopCommand) {
    clearActivityTimers(true);
    showStopMessage(currentResponseElement, stopCommand);
  } else {
    await renderMarkdown(textContainer, currentResponseMarkdown, true);
  }
}

function appendImageToCurrentResponse(type, content) {
  collapseActivitiesForOutput();
  let filesContainer = currentResponseElement.querySelector('.message-files');
  if (!filesContainer) {
    filesContainer = document.createElement('div');
    filesContainer.className = 'message-files';
    currentResponseElement.insertBefore(filesContainer, textContainer);
  }
  filesContainer.appendChild(createImageFileElement(type, content));
}
