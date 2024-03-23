import { startAudio, GranularSynth, WaveformRenderer } from "./player-utils.js";
import config from './config.js'

const audiofilesBasePath = 'audiofiles/segment';
let groupIndex = null;
let bufferCount = 0;
const fadeTime = 2;
const releaseTime = 8;
let touchX = 0.5;
let touchY = 0.5;

/*********************************************
 * websocket communication
 */
const webSocketAddr = config['server-addr'];
const webSocketPort = config['server-port'];
const socket = new WebSocket(`ws://${webSocketAddr}:${webSocketPort}`);

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
      case 'player-group': {
        groupIndex = value;
        playerMessages.innerText = 'Tap screen to start!';
        window.addEventListener('click', startPlaying);
        break;
      }

      case 'update-buffer': {
        const [index, count] = value;

        if (index !== groupIndex) {
          console.error(`Ooops: got update index ${index} and thought having player group ${groupIndex}`);
        }

        bufferCount = count;
        loadAudioBuffer(index);
        break;
      }

      case 'freeze':
        break;

      case 'period':
        granularSynth.setPeriod(0.001 * value);
        break;

      case 'duration':
        grainDuration = 0.001 * value;
        updateGrainWindow();
        break;

      case 'blur':
        grainVar = 0.001 * value;
        granularSynth.setPositionVar(0.001 * value);
        updateGrainWindow();
        break;

      case 'pitch':
        granularSynth.setResampling(value);
        break;

      case 'bubble':
        granularSynth.setResamplingVar(value);
        break;

      case 'attack':
        granularSynth.setAttack(0.01 * value);
        break;

      case 'release':
        granularSynth.setRelease(0.01 * value);
        break;

      case 'gain':
        granularSynth.setGain(dBToLin(value));
        break;

      case 'end':
        /// end
        break;

      default:
        console.error(`received invalid message: ${obj.selector} ${obj.value}`);
        break;
    }
  }
});

function sendMessage(selector, value = 0) {
  const obj = { selector, value };
  const str = JSON.stringify(obj);
  socket.send(str);
}

/*********************************************
 * graphics and audio
 */
let waveformRenderer = null;
let granularSynth = null;

let audioBuffer = null;
let grainDuration = 0.1;
let grainVar = 0.005;
let minPosition = 0;
let maxPosition = 0;

function startPlaying() {
  startAudio();

  window.removeEventListener('click', startPlaying);
  playerMessages.innerText = 'Waiting for live audio...';

  if (granularSynth === null && waveformRenderer === null) {
    waveformRenderer = new WaveformRenderer();
    granularSynth = new GranularSynth();

    sendMessage('get-params');

    if (audioBuffer !== null) {
      updateAudioBuffer(audioBuffer);
    }
  }

  window.addEventListener('resize', adaptCanvasSize);
  adaptCanvasSize();
  enablePointerEvents();
}

function stopPlaying() {
  granularSynth.stop(releaseTime);
  waveformRenderer.resetBuffer(releaseTime);
  disablePointerEvents();
  setBackgroundColor(null);
}

function updateAudioBuffer(buffer) {
  audioBuffer = buffer;

  if (granularSynth !== null && waveformRenderer !== null) {
    granularSynth.setBuffer(buffer, fadeTime);
    waveformRenderer.setBuffer(buffer, fadeTime);

    if (!granularSynth.isPlaying) {
      granularSynth.start();
      waveformRenderer.start();
      setBackgroundColor(bufferCount);
    }

    playerMessages.style.top = 'calc(100% - 1.5em)';
    playerMessages.innerHTML = 'Move your finger on screen to play.';
    playerTitle.style.opacity = 0;
  }

  updateGrainWindow();
  setTouchPosition(touchX, touchY);
}

function loadAudioBuffer(index) {
  const audioContext = new AudioContext();

  // load audio files into audio buffers
  fetch(`${audiofilesBasePath}-${index}.wav`)
    .then(data => data.arrayBuffer())
    .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
    .then(decodedAudio => {
      updateAudioBuffer(decodedAudio);

      if (granularSynth !== null && waveformRenderer !== null) {
        setBackgroundColor(bufferCount);
      }
    });
}

/*********************************************
 * graphics
 */
const playerTitle = document.getElementById('player-title');
const playerMessages = document.getElementById('player-messages');
let canvasWidth = 0;
let canvasHeight = 0;

playerTitle.innerText = config.title;

const backgroundColors = [
  '#9e9e9e', // 'light grey'
  '#b30000', // 'red'
  '#b37800', // 'orange'
  '#b3b000', // 'yellow'
  '#b3b000', // 'lime'
  '#595959', // 'dark grey'
  '#3eb300', // 'green'
  '#00b1b3', // 'turquoise'
  '#024fb3', // 'blue'
  '#4b00b3', // 'purple'
  '#b300b3', // 'magenta'
];

function setBackgroundColor(count) {
  const index = count % backgroundColors.length;

  if (index !== null) {
    document.body.style.backgroundColor = backgroundColors[index];
  } else {
    document.body.style.backgroundColor = 'transparent';
  }
}

function adaptCanvasSize() {
  const rect = document.body.getBoundingClientRect();
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  waveformRenderer.resize(canvasWidth, canvasHeight);
  updateGrainWindow();
}

function updateGrainWindow() {
  if (audioBuffer !== null) {
    const audioBufferDuration = audioBuffer.duration;
    const minPositionVar = 0.005; // see sharedParam positionVar server/index.js
    const maxDuration = audioBufferDuration - 2 * minPositionVar;
    const duration = Math.min(maxDuration, grainDuration);
    const maxPositionVar = 0.5 * (audioBufferDuration - grainDuration);
    const positionVar = Math.min(maxPositionVar, grainVar);

    if (granularSynth !== null) {
      granularSynth.setDuration(duration);
      granularSynth.setPositionVar(positionVar);
    }

    const windowDuration = duration + 2 * positionVar;
    const windowSize = windowDuration * audioBuffer.sampleRate;
    if (waveformRenderer !== null) {
      waveformRenderer.setWindowSize(windowSize);
    }

    const margin = 0.5 * windowDuration;
    minPosition = margin;
    maxPosition = audioBufferDuration - margin;
  }
}

/*********************************************
 * touch events
 */
let mouseIsDown = false;

function enablePointerEvents() {
  window.addEventListener('touchstart', onPointerStart);
  window.addEventListener('touchmove', onPointerMove);
  window.addEventListener('touchend', onPointerEnd);
  window.addEventListener('touchcancel', onPointerEnd);
  window.addEventListener('mousedown', onPointerStart);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerEnd);
}

function disablePointerEvents() {
  window.removeEventListener('touchstart', onPointerStart);
  window.removeEventListener('touchmove', onPointerMove);
  window.removeEventListener('touchend', onPointerEnd);
  window.removeEventListener('touchcancel', onPointerEnd);
  window.removeEventListener('mousedown', onPointerStart);
  window.removeEventListener('mousemove', onPointerMove);
  window.removeEventListener('mouseup', onPointerEnd);
}

function setTouchPosition(x, y) {
  touchX = x;
  touchY = y;

  if (audioBuffer !== null) {
    const audioBufferDuration = audioBuffer.duration;
    const position = Math.max(minPosition, Math.min(maxPosition, x * audioBufferDuration));
    const cutoff = Math.min(1, 1.5 - y);

    if (waveformRenderer !== null) {
      waveformRenderer.setWindowPosition(position, y);
      waveformRenderer.setWindowOpacity(cutoff);
    }

    if (granularSynth !== null) {
      granularSynth.setPosition(position);
      granularSynth.setCutoff(cutoff);
    }
  }
}

function onPointerStart(e) {
  const x = e.changedTouches ? e.changedTouches[0].pageX : e.pageX;
  const y = e.changedTouches ? e.changedTouches[0].pageY : e.pageY;
  mouseIsDown = true;
  setTouchPosition(x / canvasWidth, y / canvasHeight); // normalize coordinates with canvas size
}

function onPointerMove(e) {
  if (mouseIsDown) {
    const x = e.changedTouches ? e.changedTouches[0].pageX : e.pageX;
    const y = e.changedTouches ? e.changedTouches[0].pageY : e.pageY;
    setTouchPosition(x / canvasWidth, y / canvasHeight); // normalize coordinates with canvas size
  }
}

function onPointerEnd(e) {
  mouseIsDown = false;
}

function dBToLin(val) {
  return Math.exp(0.11512925464970229 * val); // pow(10, val / 20)
}
