let peerConnection, micStream, audioElement;
let speechInProgress = false;

async function startRealtimeSpeech() {
  stopRealtimeSpeech();
  const tokenResponse = await fetch(`/api/token?presetId=${currentPreset.id}`);
  const { client_secret } = await tokenResponse.json();

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

  const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${currentPreset.model}`, {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${client_secret.value}`, 'Content-Type': 'application/sdp' },
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

async function handleRealtimeSpeechEvent(data) {
  switch (data.type) {
    case 'input_audio_buffer.speech_started':
      removeTypingIndicator();
      if (audioAssistantTranscript) {
        addMessageToUI({ role: 'assistant', text: audioAssistantTranscript });
        audioAssistantTranscript = '';
      }
      showTypingIndicator(true);
      break;
    case 'conversation.item.input_audio_transcription.completed':
      removeTypingIndicator(true);
      audioUserTranscript = data.transcript;
      addMessageToUI({ role: 'user', text: audioUserTranscript });
      showTypingIndicator();
      break;
    case 'response.done':
      audioAssistantTranscript = data.response.output[0]?.content[0]?.transcript;
      if (!audioAssistantTranscript) return;
      const cachedInputAudioTokens = data.response.usage.input_token_details.cached_tokens_details.audio_tokens;
      const cachedInputTextTokens = data.response.usage.input_token_details.cached_tokens_details.text_tokens;
      const inputAudioTokens = data.response.usage.input_token_details.audio_tokens - cachedInputAudioTokens;
      const inputTextTokens = data.response.usage.input_token_details.text_tokens - cachedInputTextTokens;
      const outputAudioTokens = data.response.usage.output_token_details.audio_tokens;
      const outputTextTokens = data.response.usage.output_token_details.text_tokens;

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
      break;
    case 'output_audio_buffer.stopped':
      removeTypingIndicator();
      if (audioAssistantTranscript) {
        addMessageToUI({ role: 'assistant', text: audioAssistantTranscript });
        audioAssistantTranscript = '';
      }
      break;
  }
}

speakBtn.addEventListener('click', async () => {
  if (speechInProgress) {
    stopRealtimeSpeech();
    speakBtn.style.display = 'none';
    restartSpeakBtn.style.display = 'inline-block';
  } else {
    speakBtn.textContent = 'Starting...';
    await startRealtimeSpeech();
    speakBtn.textContent = 'Stop Voice Chat';
  }
});

restartSpeakBtn.addEventListener('click', async () => {
  applyPreset(currentPreset);
});