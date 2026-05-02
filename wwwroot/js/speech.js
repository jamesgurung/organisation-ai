let peerConnection, micStream, audioElement;
let speechInProgress = false;
let realtimeEventsFiltered = false;

async function startRealtimeSpeech() {
  stopRealtimeSpeech();
  const tokenResponse = await fetch(`/api/token?presetId=${currentPreset.id}`);
  const tokenData = await tokenResponse.json();
  const realtimeToken = tokenData.value ?? tokenData.client_secret?.value;
  realtimeEventsFiltered = tokenData.realtime_endpoint.includes('webrtcfilter=on');

  peerConnection = new RTCPeerConnection();

  audioElement = new Audio();
  audioElement.autoplay = true;
  peerConnection.ontrack = e => audioElement.srcObject = e.streams[0];

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  peerConnection.addTrack(micStream.getTracks()[0]);

  const dataChannel = peerConnection.createDataChannel('oai-events');
  dataChannel.addEventListener('message', (e) => { handleRealtimeSpeechEvent(JSON.parse(e.data)); });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch(tokenData.realtime_endpoint, {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${realtimeToken}`, 'Content-Type': 'application/sdp' },
  });

  await peerConnection.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
  speechInProgress = true;
}

function stopRealtimeSpeech() {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  if (audioElement) {
    audioElement.srcObject = null;
    audioElement = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  speechInProgress = false;
}

let audioUserTranscript = '';
let audioAssistantTranscript = '';
let assistantHasResponded = false;
let assistantTranscriptDisplayed = false;
let audioTurnRecorded = false;

async function handleRealtimeSpeechEvent(data) {
  console.log(data);
  switch (data.type) {
    case 'input_audio_buffer.speech_started':
      assistantHasResponded = false;
      removeTypingIndicator();
      showAssistantTranscript();
      audioUserTranscript = '';
      audioAssistantTranscript = '';
      assistantTranscriptDisplayed = false;
      audioTurnRecorded = false;
      showTypingIndicator(true);
      break;
    case 'conversation.item.input_audio_transcription.completed':
      removeTypingIndicator(true);
      audioUserTranscript = data.transcript;
      addMessageToUI({ role: 'user', text: audioUserTranscript });
      if (!assistantHasResponded) showTypingIndicator();
      break;
    case 'response.output_audio_transcript.done':
      audioAssistantTranscript = data.transcript;
      if (realtimeEventsFiltered) await recordRealtimeTurn();
      break;
    case 'response.done':
      audioAssistantTranscript ||= getAssistantTranscript(data.response);
      if (!audioAssistantTranscript) return;
      await recordRealtimeTurn(data.response.usage);
      if (data.response.status === 'failed') {
        removeTypingIndicator();
        showAssistantTranscript();
      }
      break;
    case 'output_audio_buffer.stopped':
      assistantHasResponded = true;
      removeTypingIndicator();
      showAssistantTranscript();
      break;
  }
}

async function recordRealtimeTurn(usage) {
  if (audioTurnRecorded || !audioAssistantTranscript) return;
  audioTurnRecorded = true;

  const cachedInputAudioTokens = usage?.input_token_details?.cached_tokens_details?.audio_tokens ?? 0;
  const cachedInputTextTokens = usage?.input_token_details?.cached_tokens_details?.text_tokens ?? 0;
  const inputAudioTokens = (usage?.input_token_details?.audio_tokens ?? 0) - cachedInputAudioTokens;
  const inputTextTokens = (usage?.input_token_details?.text_tokens ?? 0) - cachedInputTextTokens;
  const outputAudioTokens = usage?.output_token_details?.audio_tokens ?? 0;
  const outputTextTokens = usage?.output_token_details?.text_tokens ?? 0;

  while (!audioUserTranscript) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const response = await fetch('/api/record', {
    method: 'POST',
    headers: { 'X-XSRF-TOKEN': antiforgeryToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      presetId: currentPreset.id,
      currentChatId,
      inputAudioTokens,
      inputTextTokens,
      cachedInputAudioTokens,
      cachedInputTextTokens,
      outputAudioTokens,
      outputTextTokens,
      userTranscript: audioUserTranscript,
      assistantTranscript: audioAssistantTranscript
    })
  });

  if (!response.ok) {
    stopRealtimeSpeech();
    speakBtn.textContent = 'An error occurred.';
    speakBtn.disabled = true;
    return;
  }

  const result = await response.json();
  if (currentChatId === null) {
    currentChatId = result.id;
    const conversationEntity = { id: currentChatId, title: result.title };
    history.unshift(conversationEntity);
    const historyItem = createHistoryItem(conversationEntity);
    historyContainer.insertBefore(historyItem, historyContainer.firstChild);
  }
  spendLimitReached = result.spendLimitReached;
  if (spendLimitReached) {
    stopRealtimeSpeech();
    speakBtn.textContent = 'Weekly limit reached.';
    speakBtn.disabled = true;
  }
  if (result.content.text === '[FLAG]') {
    stopRealtimeSpeech();
    addMessageToUI({ role: 'assistant', text: '[FLAG]' });
    speakBtn.style.display = 'none';
    restartSpeakBtn.style.display = 'inline-block';
  }
}

function showAssistantTranscript() {
  if (!audioAssistantTranscript || assistantTranscriptDisplayed) return;
  addMessageToUI({ role: 'assistant', text: audioAssistantTranscript });
  assistantTranscriptDisplayed = true;
}

function getAssistantTranscript(response) {
  return response?.output
    ?.flatMap(output => output.content ?? [])
    .map(content => content.transcript ?? content.audio?.transcript)
    .find(Boolean);
}

speakBtn.addEventListener('click', async () => {
  if (speechInProgress) {
    stopRealtimeSpeech();
    speakBtn.style.display = 'none';
    restartSpeakBtn.style.display = 'inline-block';
  } else {
    welcomeMessage.style.display = 'none';
    if (currentChatId === null) chatContentContainer.innerHTML = '';
    speakBtn.disabled = true;
    speakBtn.textContent = 'Starting...';
    await startRealtimeSpeech();
    speakBtn.disabled = false;
    speakBtn.textContent = 'Stop Voice Chat';
  }
});

restartSpeakBtn.addEventListener('click', async () => {
  applyPreset(currentPreset);
});
