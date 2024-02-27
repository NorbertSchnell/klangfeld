import paramConfig from './params.js'

/*********************************************
 * websocket communication
 */
const webSocketPort = 3000;
const webSocketAddr = 'localhost';
const socket = new WebSocket(`ws://${webSocketAddr}:${webSocketPort}/controller`);

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
    const selector = obj.selector
    const value = obj.value;

    // dispatch incomming messages
    switch (selector) {
      case 'period':
      case 'duration':
      case 'blur':
      case 'pitch':
      case 'bubble':
      case 'attack':
      case 'release':
      case 'gain':
        setParameter(selector, value, false);
        break;
      
      default:
        console.error(`received invalid message: ${selector} ${value}`);
        break;
    }
  }
});

function sendMessage(selector, value) {
  const obj = { selector, value };
  const str = JSON.stringify(obj);
  socket.send(str);
}

/*********************************************
 * control
 */
const controllerElements = new Map();

for (let param of paramConfig) {
  const name = param.name;
  const container = document.querySelector(`div[data-name=${name}]`);
  const frame = container.querySelector(`.slider-frame`);
  const slider = container.querySelector(`.slider`);
  const number = container.querySelector(`.number`);
  const elems = { param, container, frame, slider, number };

  controllerElements.set(name, elems);
  setParameter(name, null, false);
  addPointerListeners(frame);
}

function addPointerListeners(elem) {
  window.addEventListener('touchstart', onPointerStart);
  window.addEventListener('touchmove', onPointerMove);
  window.addEventListener('touchend', onPointerEnd);
  window.addEventListener('touchcancel', onPointerEnd);
  window.addEventListener('mousedown', onPointerStart);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerEnd);
}

let target = null;

function onPointerStart(e) {
  const x = e.changedTouches ? e.changedTouches[0].pageX : e.pageX;
  const y = e.changedTouches ? e.changedTouches[0].pageY : e.pageY;

  target = document.elementFromPoint(x, y);

  const name = target.dataset.name;
  const norm = getTouchPosition(target, x);

  switch (target.className) {
    case 'slider-frame':
      setParameterNormalized(name, norm, true);
      break;
    case 'label':
      setParameterNormalized(name, null, true);
      break;
  }
}

function onPointerMove(e) {
  if (target !== null) {
    const x = e.changedTouches ? e.changedTouches[0].pageX : e.pageX;
    const name = target.dataset.name;
    const norm = getTouchPosition(target, x);
    setParameterNormalized(name, norm, true);
  }
}

function onPointerEnd(e) {
  target = null;
}

function getTouchPosition(target, x) {
  const rect = target.getBoundingClientRect();
  const norm = (x - rect.x) / rect.width;
  return Math.max(0, Math.min(1, norm));
}

function setParameter(name, value = null, send = false) {
  const elems = controllerElements.get(name);

  if (elems !== undefined) {
    const param = elems.param;

    if (value === null) {
      value = param.def;
    }

    const norm = (value - param.min) / (param.max - param.min);
    updateParameter(param, elems, value, norm, send);
  }
}

function setParameterNormalized(name, norm = null, send = false) {
  const elems = controllerElements.get(name);

  if (elems !== undefined) {
    const param = elems.param;

    if (norm === null) {
      norm = (param.def - param.min) / (param.max - param.min);
    }

    const value = Math.round((param.max - param.min) * norm + param.min);
    updateParameter(param, elems, value, norm, send);
  }
}

function updateParameter(param, elems, value, norm, send = false) {
  const sliderElem = elems.slider;
  const numberElem = elems.number;

  if (param.min >= 0) {
    sliderElem.style.width = `${100 * norm}%`;
    sliderElem.style.left = 0;
  } else {
    const lowerHalf = -param.min / (param.max - param.min);

    if (norm >= lowerHalf) {
      sliderElem.style.width = `${100 * (norm - lowerHalf)}%`;
      sliderElem.style.left = `${100 * lowerHalf}%`;
    } else {
      sliderElem.style.width = `${100 * (lowerHalf - norm)}%`;
      sliderElem.style.left = `${100 * norm}%`;
    }
  }

  numberElem.innerText = value;

  if (send) {
    sendMessage(param.name, value);
  }
}
