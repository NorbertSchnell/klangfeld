import config from './config.js'

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

/****************************************************************
 * websocket communication
 */
const webSocketAddr = config['server-addr'];
const webSocketPort = config['server-port'];
const socket = new WebSocket(`ws://${webSocketAddr}:${webSocketPort}/recorder`);
const audioSocket = new WebSocket(`ws://${webSocketAddr}:${webSocketPort}/audio`);
audioSocket.binaryType = 'arraybuffer';

// listen to opening websocket connections
socket.addEventListener('open', (event) => {
  // send regular ping messages
  setInterval(() => {
    if (socket.readyState == socket.OPEN) {
      socket.send('');
    }
  }, 10000);
});

// listen to messages from server
socket.addEventListener('message', (event) => {
  const message = event.data;

  if (message.length > 0) {
    const obj = JSON.parse(message);
    const value = obj.value;

    // dispatch incomming messages
    switch (obj.selector) {
      case 'recorder-ok': {
        if (value) {
          recordButton.classList.add('enabled');
          sendMessage('get-params');
        } else {
          console.log('recorder not ok');
        }
        break;
      }

      case 'freeze': {
        // ??? freeze
        break;
      }

      case 'end': {
        // ??? end
        break;
      }

      default:
        break;
    }
  }
});

function sendMessage(selector, value = 0) {
  const obj = { selector, value };
  const str = JSON.stringify(obj);
  socket.send(str);
}

/****************************************************************
 * recording
 */
const bufferSize = 4096;
const buffer = new Float32Array(bufferSize);
let stream = null;
let scriptProcessor = null;
let audioIn = null;
let gain = 1.0;

const recordButton = document.getElementById('record-button');
recordButton.addEventListener('click', () => {
  if (stream === null) {
    startRecording();
  } else {
    stopRecording();
  }
});

function startRecording() {
  recordButton.classList.add('active');

  if (audioContext === null) {
    audioContext = new AudioContext();
  }

  startAudioStream();
  recordButton.innerText = 'recording';
}

function stopRecording() {
  if (stream !== null) {
    recordButton.classList.remove('active');
    stopAudioStream();
    recordButton.innerText = 'start recorder';
  }
}

function startAudioStream() {
  navigator.getUserMedia({
    audio: {
      noiseSuppression: false,
      echoCancellation: false
    }
  }, (audioStream) => {
    stream = audioStream;

    scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    scriptProcessor.connect(audioContext.destination);
    scriptProcessor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);

      if (gain !== 1) {
        for (let i = 0; i < data.length; i++)
          data[i] *= gain;
      }

      buffer.set(data, 0);
      audioSocket.send(buffer);
    }

    sendMessage('init-stream');

    audioIn = audioContext.createMediaStreamSource(stream);
    audioIn.connect(scriptProcessor);
  }, (err) => console.error(err.stack));
}

function stopAudioStream() {
  scriptProcessor.disconnect();
  scriptProcessor = null;

  audioIn.disconnect();
  audioIn = null;

  stream.getTracks()[0].stop();
  stream = null;
}

/**********************************************
 * draw waveform
 */
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
let canvasWidth = 0;
let canvasHeight = 0;

window.addEventListener('resize', adaptCanvasSize);
adaptCanvasSize();
requestAnimationFrame(renderWaveform);

function adaptCanvasSize() {
  const rect = document.body.getBoundingClientRect();
  canvas.width = canvasWidth = rect.width;
  canvas.height = canvasHeight = rect.height;
}

function renderWaveform() {
  context.save();
  context.clearRect(0, 0, canvasWidth, canvasHeight);

  if (buffer) {
    context.strokeStyle = '#fff';
    context.globalAlpha = 1;
    drawWaveform(context, canvasWidth, canvasHeight, buffer);
  }

  context.restore();

  requestAnimationFrame(renderWaveform);
}

function drawWaveform(ctx, width, height, waveform) {
  const samplesPerPixel = waveform.length / width;
  const center = 0.5 * height;
  const fullamp = 0.5 * height;
  let fEnd = 0;
  let start = 0;
  let lastX = null;
  let lastY = null;

  ctx.beginPath();

  for (let i = 0; i < width; i++) {
    let min = Infinity;
    let max = -Infinity;

    fEnd += samplesPerPixel;
    let end = Math.floor(fEnd + 0.5);

    for (let j = start; j < end; j++) {
      const value = waveform[j];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    const x = i;
    const y = center - fullamp * min + 0.5;

    if (i === 0) {
      ctx.moveTo(x, center - fullamp * max);
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, center - fullamp * max);
      ctx.lineTo(x, y);
    }

    start = end;
    lastX = x;
    lastY = y;
  }

  ctx.stroke();
}
