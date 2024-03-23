let audioContext = new AudioContext();
let scheduler = null;

export async function startAudio() {
  if (audioContext === null) {
    await audioContext.resume();
  }

  if (scheduler === null) {
    scheduler = new SimpleScheduler();
  }
}

/*************************************************
 * granular synth
 */
class AudioTimeEngine {
  constructor() {
    this.master = null;
    this.outputNode = null;
  }

  get currentTime() {
    if (this.master)
      return this.master.currentTime;

    return undefined;
  }

  resetTime(time = undefined) {
    if (this.master)
      this.master.resetEngineTime(this, time);
  }

  resetPosition(position = undefined) {
    if (this.master)
      this.master.resetEnginePosition(this, position);
  }

  connect(target) {
    this.outputNode.connect(target);
    return this;
  }

  disconnect(connection) {
    this.outputNode.disconnect(connection);
    return this;
  }
}

class SimpleScheduler {
  constructor(options = {}) {
    this.__engines = new Set();

    this.__schedEngines = [];
    this.__schedTimes = [];

    this.__currentTime = null;
    this.__timeout = null;

    this.period = options.period || 0.025;
    this.lookahead = options.lookahead || 0.1;
  }

  __scheduleEngine(engine, time) {
    this.__schedEngines.push(engine);
    this.__schedTimes.push(time);
  }

  __rescheduleEngine(engine, time) {
    const index = this.__schedEngines.indexOf(engine);

    if (index >= 0) {
      if (time !== Infinity) {
        this.__schedTimes[index] = time;
      } else {
        this.__schedEngines.splice(index, 1);
        this.__schedTimes.splice(index, 1);
      }
    } else if (time < Infinity) {
      this.__schedEngines.push(engine);
      this.__schedTimes.push(time);
    }
  }

  __unscheduleEngine(engine) {
    const index = this.__schedEngines.indexOf(engine);

    if (index >= 0) {
      this.__schedEngines.splice(index, 1);
      this.__schedTimes.splice(index, 1);
    }
  }

  __resetTick() {
    if (this.__schedEngines.length > 0) {
      if (!this.__timeout) {
        this.__tick();
      }
    } else if (this.__timeout) {
      clearTimeout(this.__timeout);
      this.__timeout = null;
    }
  }

  __tick() {
    const currentTime = audioContext.currentTime;
    let i = 0;

    while (i < this.__schedEngines.length) {
      const engine = this.__schedEngines[i];
      let time = this.__schedTimes[i];

      while (time && time <= currentTime + this.lookahead) {
        time = Math.max(time, currentTime);
        this.__currentTime = time;
        time = engine.advanceTime(time);
      }

      if (time && time < Infinity) {
        this.__schedTimes[i++] = time;
      } else {
        this.__unscheduleEngine(engine);

        // remove engine from scheduler
        if (!time) {
          engine.master = null;
          this.__engines.delete(engine);
        }
      }
    }

    this.__currentTime = null;
    this.__timeout = null;

    if (this.__schedEngines.length > 0) {
      this.__timeout = setTimeout(() => {
        this.__tick();
      }, this.period * 1000);
    }
  }

  get currentTime() {
    return this.__currentTime || audioContext.currentTime + this.lookahead;
  }

  add(engine, time = this.currentTime) {
    if (engine.master)
      throw new Error("object has already been added to a master");

    // set master and add to array
    engine.master = this;
    this.__engines.add(engine);

    // schedule engine
    this.__scheduleEngine(engine, time);
    this.__resetTick();
  }

  remove(engine) {
    if (!engine.master || engine.master !== this)
      throw new Error("engine has not been added to this scheduler");

    // reset master and remove from array
    engine.master = null;
    this.__engines.delete(engine);

    // unschedule engine
    this.__unscheduleEngine(engine);
    this.__resetTick();
  }

  resetEngineTime(engine, time = this.currentTime) {
    this.__rescheduleEngine(engine, time);
    this.__resetTick();
  }

  has(engine) {
    return this.__engines.has(engine);
  }

  clear() {
    if (this.__timeout) {
      clearTimeout(this.__timeout);
      this.__timeout = null;
    }

    this.__schedEngines.length = 0;
    this.__schedTimes.length = 0;
  }
}

class FadingGranularEngine extends AudioTimeEngine {
  constructor() {
    super();

    this.buffer = null;
    this.period = 0.01;
    this.position = 0.5;
    this.positionVar = 0.003;
    this.duration = 0.1;
    this.attack = 0.5;
    this.release = 0.5;
    this.resampling = 0;
    this.resamplingVar = 0;
    this.gain = 0;

    this.targetGain = 0;
    this.gainIncr = 0;

    this.outputNode = audioContext.createGain();
  }

  get bufferDuration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  advanceTime(time) {
    const targetGain = this.targetGain;
    let gainIncr = this.gainIncr;
    let gain = this.gain + gainIncr;

    if ((gainIncr > 0 && gain > targetGain) || (gainIncr < 0 && gain < targetGain)) {
      gain = targetGain;
      gainIncr = 0;
    }

    this.gain = gain;

    if (gain > 0) {
      time = Math.max(time, audioContext.currentTime);
      return time + this.trigger(time);
    }

    return undefined;
  }

  trigger(time) {
    let grainTime = time || audioContext.currentTime;
    let grainPeriod = this.period;
    let grainDuration = this.duration;
    let grainPosition = this.position - 0.5 * grainDuration;

    if (this.buffer) {
      let resamplingRate = 1.0;

      if (this.resampling !== 0 || this.resamplingVar > 0) {
        const randomResampling = (Math.random() - 0.5) * 2.0 * this.resamplingVar;
        resamplingRate = Math.pow(2.0, (this.resampling + randomResampling) / 1200.0);
      }

      if (this.positionVar > 0)
        grainPosition += (2.0 * Math.random() - 1) * this.positionVar;

      const bufferDuration = this.bufferDuration;

      if (grainPosition < 0 || grainPosition >= bufferDuration) {
        if (grainPosition < 0) {
          grainTime -= grainPosition;
          grainDuration += grainPosition;
          grainPosition = 0;
        }

        if (grainPosition + grainDuration > bufferDuration)
          grainDuration = bufferDuration - grainPosition;
      }

      if (this.gain > 0 && grainDuration >= 0.001) {
        const envelope = audioContext.createGain();
        let attack = this.attack * grainDuration;
        let release = this.release * grainDuration;

        if (attack + release > grainDuration) {
          const factor = grainDuration / (attack + release);
          attack *= factor;
          release *= factor;
        }

        const attackEndTime = grainTime + attack;
        const grainEndTime = grainTime + grainDuration / resamplingRate;
        const releaseStartTime = grainEndTime - release;

        envelope.gain.value = 0;

        envelope.gain.setValueAtTime(0.0, grainTime);
        envelope.gain.linearRampToValueAtTime(this.gain, attackEndTime);

        if (releaseStartTime > attackEndTime)
          envelope.gain.setValueAtTime(this.gain, releaseStartTime);

        envelope.gain.linearRampToValueAtTime(0.0, grainEndTime);

        envelope.connect(this.outputNode);

        const source = audioContext.createBufferSource();
        source.buffer = this.buffer;
        source.playbackRate.value = resamplingRate;
        source.connect(envelope);

        source.start(grainTime, grainPosition);
        source.stop(grainEndTime);
      }
    }

    return Math.max(0.01, grainPeriod); // no grains shorter than 10ms
  }

  fade(target, duration) {
    this.gainIncr = (target - this.gain) / (duration / this.period);
    this.targetGain = target;
  }

  fadeIn(duration) {
    this.fade(1, duration);
  }

  fadeOut(duration) {
    this.fade(0, duration);
  }
}

export class GranularSynth {
  constructor() {
    this.output = audioContext.createGain();
    this.output.connect(audioContext.destination);

    this.minCutoffFreq = 20;
    this.maxCutoffFreq = 0.5 * audioContext.sampleRate;
    this.logCutoffRatio = Math.log(this.maxCutoffFreq / this.minCutoffFreq);

    this.cutoff = audioContext.createBiquadFilter();
    this.cutoff.connect(this.output);
    this.cutoff.type = 'lowpass';
    this.cutoff.frequency.value = this.maxCutoffFreq;
    this.cutoff.Q.value = 0;

    this.engines = [];

    for (let index = 0; index < 2; index++) {
      const engine = new FadingGranularEngine();
      engine.connect(this.cutoff);
      this.engines[index] = engine;
    }

    this.currentIndex = 0;
    this.isPlaying = false;
  }

  start() {
    this.isPlaying = true;
  }

  stop(fadeTime = 2) {
    const engine = this.engines[this.currentIndex];
    engine.fadeOut(fadeTime);

    this.isPlaying = false;
  }

  // cross fade between currentEngine and next engine when new buffer
  setBuffer(buffer, fadeTime = 2) {
    const prevIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % 2;

    const prevEngine = this.engines[prevIndex];
    const nextEngine = this.engines[this.currentIndex];

    prevEngine.fadeOut(fadeTime);

    nextEngine.buffer = buffer;
    nextEngine.fadeIn(fadeTime);

    if (!scheduler.has(nextEngine)) {
      scheduler.add(nextEngine);
      nextEngine.position = 0.5 * buffer.duration;
    } else {
      nextEngine.position = prevEngine.position;
    }
  }

  setCutoff(factor) {
    this.cutoff.frequency.value = this.minCutoffFreq * Math.exp(this.logCutoffRatio * factor);
  }

  setPosition(position) {
    const engine = this.engines[this.currentIndex];
    const buffer = engine.buffer;

    if (buffer)
      engine.position = position;
  }

  setResampling(resampling) {
    this.engines.forEach((engine) => engine.resampling = resampling);
  }

  setResamplingVar(resamplingVar) {
    this.engines.forEach((engine) => engine.resamplingVar = resamplingVar);
  }

  setPeriod(value) {
    this.engines.forEach((engine) => engine.period = value);
  }

  setDuration(value) {
    this.engines.forEach((engine) => engine.duration = value);
  }

  setPositionVar(value) {
    this.engines.forEach((engine) => engine.positionVar = value);
  }

  setAttack(value) {
    this.engines.forEach((engine) => engine.attack = value);
  }

  setRelease(value) {
    this.engines.forEach((engine) => engine.release = value);
  }

  setGain(value) {
    this.output.gain.value = value;
  }
}

/*************************************************
 * waveform graphics
 */
export class WaveformRenderer {
  constructor() {
    this.currentTime = null;
    this.canvasWidth = 0;
    this.canvasHeight = 0;

    this.buffer = null;
    this.windowPosition = 0;
    this.windowY = 0.5;
    this.windowSize = 0;
    this.windowVar = 0;
    this.windowOpacity = 0.5;

    const waveCvs = [null, null];
    waveCvs[0] = document.getElementById('wave-cvs-a');
    waveCvs[1] = document.getElementById('wave-cvs-b');
    waveCvs[0].width = waveCvs[1].width = this.canvasWidth;
    waveCvs[0].height = waveCvs[1].height = this.canvasHeight;

    this.windCvs = document.getElementById('wind-cvs');
    this.waveCvs = waveCvs;

    this.waveToggle = false;
    this.waveUpdate = false;
    this.windUpdate = false;

    this.render = this.render.bind(this);
  }

  start() {
    requestAnimationFrame(this.render);
  }

  setBuffer(buffer, fadeTime = 2) {
    const windCvs = this.windCvs;

    if (this.buffer === null) {
      windCvs.style.transitionProperty = 'opacity';
      windCvs.style.transitionDuration = `${fadeTime + 1}s`;
      windCvs.style.opacity = 1;
    } else if (buffer === null) {
      windCvs.style.transitionProperty = 'opacity';
      windCvs.style.transitionDuration = `${fadeTime + 1}s`;
      windCvs.style.opacity = 0;
    }

    this.buffer = buffer;

    let index = 0 + this.waveToggle;
    let waveCvs = this.waveCvs[index];
    waveCvs.style.transitionProperty = 'opacity';
    waveCvs.style.transitionDuration = `${fadeTime + 1}s`;
    waveCvs.style.opacity = 0;

    this.waveToggle = !this.waveToggle;

    index = 0 + this.waveToggle;
    waveCvs = this.waveCvs[index];
    waveCvs.style.transitionProperty = 'opacity';
    waveCvs.style.transitionDuration = `${fadeTime + 1}s`;
    waveCvs.style.opacity = 1;

    this.waveUpdate = true;
  }

  resetBuffer(fadeTime = 2) {
    this.setBuffer(null, fadeTime);
  }

  setWindowSize(value) {
    this.windowSize = value;
    this.windUpdate = true;
  }

  setWindowPosition(position, y) {
    this.windowPosition = position * this.buffer.sampleRate;
    this.windowY = y;
    this.windUpdate = true;
  }

  setWindowOpacity(value) {
    this.windowOpacity = value;
    this.windUpdate = true;
  }

  resize(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.waveCvs[0].width = this.waveCvs[1].width = this.windCvs.width = canvasWidth;
    this.waveCvs[0].height = this.waveCvs[1].height = this.windCvs.height = canvasHeight;
    this.waveUpdate = true;
    this.windUpdate = true;
  }

  renderWaveform(ctx) {
    const buffer = this.buffer;
    const width = this.canvasWidth;
    const height = this.canvasHeight;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    if (buffer) {
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.666;
      drawWaveform(ctx, width, height, buffer.getChannelData(0));
    }

    ctx.restore();
  }

  renderWindow(ctx) {
    const buffer = this.buffer;

    if (buffer) {
      const waveform = buffer.getChannelData(0);
      const width = this.canvasWidth;
      const height = this.canvasHeight;

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      const samplesPerPixel = waveform.length / width;
      const x = this.windowPosition / samplesPerPixel;
      const y = this.windowY * height - 50;
      const windWidth = this.windowSize / samplesPerPixel;
      const halfWind = 0.5 * windWidth;
      const opacity = this.windowOpacity;

      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.5 * opacity;

      ctx.fillRect(x - halfWind, 0, windWidth, height);
      ctx.restore();
    }
  }

  render() {
    if (this.waveUpdate) {
      const index = 0 + this.waveToggle;
      const ctx = this.waveCvs[index].getContext('2d');
      this.renderWaveform(ctx);
      this.waveUpdate = false;
    }

    if (this.windUpdate) {
      const ctx = this.windCvs.getContext('2d');
      this.renderWindow(ctx);
      this.windUpdate = false;
    }

    requestAnimationFrame(this.render);
  }
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
