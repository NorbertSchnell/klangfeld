const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

const recordButton = document.getElementById('record-button');
recordButton.addEventListener('click', () => {
  if (stream === null) {
    recordButton.classList.add('active');

    if (audioContext === null) {
      audioContext = new AudioContext();
    }

    startRecording();
    recordButton.innerText = 'recording';
  } else {
    recordButton.classList.remove('active');
    stopRecording();
    recordButton.innerText = 'start recorder';
  }
});

let clientIndex = -1;
let gain = 1.0;

/****************************************************************
 * websocket communication
 */
const webSocketPort = 3000;
const webSocketAddr = 'localhost';
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

    // dispatch incomming messages
    switch (obj.selector) {
      case 'recorder-ok':
        const isOk = obj.value;

        if (isOk) {
          recordButton.classList.add('enabled');
        } else {
          console.log('recorder not ok');
        }
        break;

      default:
        break;
    }
  }
});

function sendMessage(socket, selector, value) {
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

function startRecording() {
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

    sendMessage(socket, 'start');

    audioIn = audioContext.createMediaStreamSource(stream);
    audioIn.connect(scriptProcessor);
  }, (err) => console.error(err.stack));
}

function stopRecording() {
  sendMessage(socket, 'stop');

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
