import wavefile from 'wavefile';
import fs from 'node:fs/promises';
import express from 'express';
import WebSocket from 'ws';
import http from 'http';
import paramConfig from './params.js';

const recordFilePath = process.cwd() + '/audiofiles';
const recordFileBaseName = 'record';
const sampleRate = 48000;
const bufferSize = sampleRate;

/****************************************************************
 * http server
 */
const httpPort = 3000;
const app = express();

const httpServer = http
  .createServer(app)
  .listen(httpPort, () => console.log(`HTTP server listening on port ${httpPort}`));

app.use(express.static('.'));

/****************************************************************
 * websocket server
 */
const webSocketServer = new WebSocket.Server({ server: httpServer });
console.log(`websocket server listening`);

let controllerSockets = new Set();
let recorderSocket = null;

webSocketServer.on('connection', (socket, req) => {
  switch (req.url) {
    // controller clients
    case '/controller': {
      controllerSockets.add(socket);

      socket.on('close', () => {
        controllerSockets.delete(socket);
      });

      socket.on('message', (message) => {
        if (message.length > 0) {
          const obj = JSON.parse(message);
          receiveControllerParameter(socket, obj.selector, obj.value);
        }
      });

      break;
    }

    // unique recorder client
    case '/recorder': {
      if (recorderSocket !== null) {
        sendMessage(socket, 'recorder-ok', false);
      } else {
        recorderSocket = socket;
        sendMessage(socket, 'recorder-ok', true);

        socket.on('close', () => {
          recorderSocket = null;
        });

        socket.on('message', (message) => {
          if (message.length > 0) {
            const obj = JSON.parse(message);

            switch (obj.selector) {
              case 'start': {
                startRecording();
                console.log('recorder started');
                break;
              }

              case 'stop': {
                stopRecording();
                console.log('recorder stopped');
                break;
              }
            }
          }
        });
      }

      break;
    }

    // audio frames from recorder client
    case '/audio': {
      socket.on('message', (message) => {
        if (message.length > 0) {
          apaendAudioFrame(message);
        }
      });

      break;
    }

    // player clients
    default: {
      const groupIndex = addPlayerToSmallestGroup(socket);
      sendMessage(socket, 'player-group', groupIndex);

      socket.on('close', () => {
        removePlayerFromGroups(socket);
      });

      break;
    }
  }

  socket.on('message', (message) => {
    if (message.length === 0) {
      socket.send('');
    }
  });
});

function sendMessage(socket, selector, value) {
  const obj = { selector, value };
  const str = JSON.stringify(obj);
  socket.send(str);
}

function sendStrToSet(set, str, except = null) {
  for (let socket of set) {
    if (socket !== except) {
      socket.send(str);
    }
  }
}

function sendToAllControllers(selector, value, except) {
  const obj = { selector, value };
  const str = JSON.stringify(obj);
  sendStrToSet(controllerSockets, str, except);
}

function sendToAllPlayers(selector, value) {
  const obj = { selector, value };
  const str = JSON.stringify(obj);

  for (let group of playerGroups) {
    sendStrToSet(group, str);
  }
}

/****************************************************************
 * player groups
 */
const numPlayerGroups = 10;
const playerGroups = [];

for (let i = 0; i < numPlayerGroups; i++) {
  const group = new Set();
  playerGroups.push(group);
}

function addPlayerToSmallestGroup(socket) {
  const minSize = Infinity;
  let smallestGroup = playerGroups[0];
  let groupIndex = 0;

  for (let i = 1; i < numPlayerGroups; i++) {
    const group = playerGroups[i];
    const size = group.size;

    if (size < smallestGroup.size) {
      smallestGroup = group;
      groupIndex = i;
    }
  }

  smallestGroup.add(socket);

  return groupIndex;
}

function removePlayerFromGroups(socket) {
  for (let group of playerGroups) {
    if (group.delete(socket)) {
      break;
    }
  }
}

function notifyPlayerGroup(index, count) {
  const group = playerGroups[index];

  for (let socket of group) {
    sendMessage(socket, 'update-buffer', [index, count]);
  }
}

/********************************************
 * controller parameters
 */
const controllerParams = {};

for (let param of paramConfig) {
  controllerParams[param.name] = param.def;
}

function receiveControllerParameter(socket, selector, value) {
  controllerParams[selector] = value;
  sendToAllControllers(selector, value, socket);
  sendToAllPlayers(selector, value);
}

/********************************************
 * process audio frame from recorder
 */
const wav = new wavefile.WaveFile();
const audioBuffers = [];
const numBuffers = 4;
let bufferCount = -1;
let indexInBuffer = 0;

for (let i = 0; i < numBuffers; i++) {
  const buffer = new Int16Array(2 * bufferSize);
  audioBuffers.push(buffer);
}

function startRecording() {
  indexInBuffer = 0;
  bufferCount = -1;
}

function stopRecording() {
}

function apaendAudioFrame(data) {
  const frameSize = data.length / 4;
  let indexInFrame = 0;

  while (indexInFrame < frameSize) {
    const currentBuffer = audioBuffers[(numBuffers + bufferCount) % numBuffers];
    const nextBuffer = audioBuffers[(numBuffers + bufferCount + 1) % numBuffers];
    const spaceLeftInBuffer = bufferSize - indexInBuffer;
    const samplesLeftInFrame = frameSize - indexInFrame;
    const copySize = Math.min(spaceLeftInBuffer, samplesLeftInFrame);

    for (let i = 0; i < copySize; i++) {
      const sampleValue = Math.round(32768 * data.readFloatLE(4 * (indexInFrame + i)));
      currentBuffer[bufferSize + indexInBuffer + i] = nextBuffer[indexInBuffer + i] = sampleValue;
    }

    indexInFrame += copySize;
    indexInBuffer += copySize;

    if (indexInBuffer >= bufferSize) {
      // write file if at least two buffers hav been recorded
      if (bufferCount >= 0) {
        const fileIndex = bufferCount % numPlayerGroups;
        const outputFilePath = `${recordFilePath}/${recordFileBaseName}-${fileIndex}.wav`;

        wav.fromScratch(1, sampleRate, '16', currentBuffer);
        fs.writeFile(outputFilePath, wav.toBuffer());

        notifyPlayerGroup(fileIndex, bufferCount);
      }

      bufferCount++;
      indexInBuffer = 0;
    }
  }
}