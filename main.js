// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = '3c23559b0257e7facbe7ba782a600109';

// ─── App state ────────────────────────────────────────────────────────────────

let cities = JSON.parse(localStorage.getItem('ws_cities') || '[]');
let activeCity = null;
let currentView = 'main';

// ─── Audio state ──────────────────────────────────────────────────────────────

let audioCtx = null;
let masterGain = null;
let reverbNode = null;
let isPlaying = false;

let droneNodes = null;
let windNodes  = null;
let padNodes   = null;
let rainTimeout = null;

let params = {
  drone: { mix: 0.7, fmRatio: 2, detune: 8 },
  wind:  { mix: 0.5, cutoff: 800, Q: 6 },
  pad:   { mix: 0.4, harmonics: 6, shimmer: 0.3 },
  rain:  { mix: 0.5, density: 1,  pitch: 600 }
};

// ─── View routing ─────────────────────────────────────────────────────────────

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name + '-view').classList.add('active');
  currentView = name;

  // Stop audio when navigating away from detail view
  if (name !== 'detail' && isPlaying) {
    stopSynth();
    isPlaying = false;
    const btn = document.getElementById('playBtn');
    const label = document.getElementById('playLabel');
    if (btn) btn.classList.remove('playing');
    if (label) label.textContent = 'Play';
  }

  // Reset edit mode when returning to main
  if (name === 'main') {
    editMode = false;
    const editBtn = document.getElementById('editBtn');
    if (editBtn) { editBtn.textContent = 'Edit'; editBtn.style.color = ''; }
  }

  // sync tab bar
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + (name === 'detail' ? 'main' : name));
  if (tabEl) tabEl.classList.add('active');

  if (name === 'search') {
    setTimeout(() => document.getElementById('searchInput').focus(), 120);
  }
  if (name === 'main') {
    renderCityList();
  }
}

function deleteActiveCity() {
  if (!activeCity) return;
  const idx = cities.findIndex(c => c.name === activeCity.name && c.country === activeCity.country);
  if (idx === -1) return;
  const name = activeCity.name;
  if (isPlaying) { stopSynth(); isPlaying = false; }
  cities.splice(idx, 1);
  saveCities();
  activeCity = null;
  showToast(`${name} removed`);
  switchView('main');
}

function switchTab(name) {
  if (name === 'search') switchView('search');
  else if (name === 'blog') switchView('blog');
  else switchView('main');
}

// ─── Weather fetch ────────────────────────────────────────────────────────────

async function fetchWeather(city) {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.cod !== 200) throw new Error(data.message || 'City not found');
  return {
    name:      data.name,
    country:   data.sys.country,
    temp:      Math.round(data.main.temp),
    feels:     Math.round(data.main.feels_like),
    tempMin:   Math.round(data.main.temp_min),
    tempMax:   Math.round(data.main.temp_max),
    humidity:  data.main.humidity,
    wind:      parseFloat(data.wind.speed.toFixed(1)),
    clouds:    data.clouds.all,
    desc:      capitalize(data.weather[0].description),
    icon:      data.weather[0].icon,
    id:        data.weather[0].id,
    dt:        data.dt,
    timezone:  data.timezone,
  };
}

// ─── Condition helpers ────────────────────────────────────────────────────────

function conditionClass(iconCode, weatherId) {
  const night = iconCode && iconCode.endsWith('n');
  if (weatherId >= 200 && weatherId < 300) return 'thunderstorm';
  if (weatherId >= 300 && weatherId < 400) return 'drizzle';
  if (weatherId >= 500 && weatherId < 600) return 'rainy';
  if (weatherId >= 600 && weatherId < 700) return 'snowy';
  if (weatherId >= 700 && weatherId < 800) return 'foggy';
  if (weatherId === 800) return night ? 'clear-night' : 'clear-day';
  if (weatherId > 800) return 'cloudy';
  return 'clear-day';
}

function conditionEmoji(iconCode, weatherId) {
  const night = iconCode && iconCode.endsWith('n');
  if (weatherId >= 200 && weatherId < 300) return '⛈';
  if (weatherId >= 300 && weatherId < 400) return '🌦';
  if (weatherId >= 500 && weatherId < 600) return weatherId >= 502 ? '🌧' : '🌦';
  if (weatherId >= 600 && weatherId < 700) return '❄️';
  if (weatherId >= 700 && weatherId < 800) return '🌫';
  if (weatherId === 800) return night ? '🌙' : '☀️';
  if (weatherId === 801) return '🌤';
  if (weatherId === 802) return '⛅️';
  return '☁️';
}

function localTime(timezone) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const local = new Date(utc + timezone * 1000);
  return local.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── City list rendering ──────────────────────────────────────────────────────

let editMode = false;

function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('editBtn');
  btn.textContent = editMode ? 'Done' : 'Edit';
  btn.style.color = editMode ? '#fff' : '';
  renderCityList();
}

function deleteCity(idx, e) {
  e.stopPropagation();
  const name = cities[idx].name;
  if (isPlaying && activeCity && activeCity.name === name) {
    stopSynth();
    isPlaying = false;
  }
  cities.splice(idx, 1);
  saveCities();
  showToast(`${name} removed`);
  renderCityList();
}

function renderCityList() {
  const list = document.getElementById('cityList');
  const empty = document.getElementById('emptyState');
  const editBtn = document.getElementById('editBtn');

  if (editBtn) editBtn.style.display = cities.length > 0 ? 'inline-block' : 'none';

  if (cities.length === 0) {
    editMode = false;
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = cities.map((c, i) => `
    <div class="city-card ${conditionClass(c.icon, c.id)} ${editMode ? 'edit-mode' : ''}" onclick="${editMode ? '' : `openCity(${i})`}">
      ${editMode ? `
        <button class="card-delete-circle" onclick="deleteCity(${i}, event)" title="Remove ${c.name}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ''}
      <div class="card-icon">${conditionEmoji(c.icon, c.id)}</div>
      ${isPlaying && activeCity && activeCity.name === c.name && !editMode ? '<div class="card-playing-dot"></div>' : ''}
      <div class="card-top">
        <div>
          <div class="card-city">${c.name}</div>
          <div class="card-time">${localTime(c.timezone)}</div>
        </div>
        <div class="card-temp">${c.temp}<sup>°</sup></div>
      </div>
      <div class="card-bottom">
        <div class="card-desc">${c.desc}</div>
        <div class="card-range">H:${c.tempMax}° L:${c.tempMin}°</div>
      </div>
    </div>
  `).join('');
}

// ─── Open city detail ─────────────────────────────────────────────────────────

function openCity(idx) {
  const c = cities[idx];
  activeCity = c;

  const hero = document.getElementById('detailHero');
  hero.className = 'detail-hero ' + conditionClass(c.icon, c.id);

  document.getElementById('detailIcon').textContent  = conditionEmoji(c.icon, c.id);
  document.getElementById('detailCity').textContent  = `${c.name}, ${c.country}`;
  document.getElementById('detailDesc').textContent  = c.desc;
  document.getElementById('detailTemp').innerHTML    = `${c.temp}<sup>°</sup>`;
  document.getElementById('detailRange').textContent = `H:${c.tempMax}°  L:${c.tempMin}°`;
  document.getElementById('dWind').textContent   = c.wind;
  document.getElementById('dHumid').textContent  = c.humidity;
  document.getElementById('dClouds').textContent = c.clouds;
  document.getElementById('dFeels').textContent  = c.feels;

  tuneToWeather(c);
  switchView('detail');
  requestAnimationFrame(resizeCanvas);
}

// ─── Search ───────────────────────────────────────────────────────────────────

let searchTimer = null;

function onSearchInput(val) {
  clearTimeout(searchTimer);
  const results = document.getElementById('searchResults');
  if (!val.trim()) {
    results.innerHTML = '<div class="search-hint">Search for a city to add it to your list and tune the synth.</div>';
    return;
  }
  results.innerHTML = '<div class="search-hint">Searching...</div>';
  searchTimer = setTimeout(() => doSearch(val.trim()), 420);
}

let pendingSearchResult = null;

async function doSearch(query) {
  const results = document.getElementById('searchResults');
  try {
    const data = await fetchWeather(query);
    pendingSearchResult = data;
    const already = cities.some(c => c.name === data.name && c.country === data.country);
    results.innerHTML = `
      <div class="search-result-item">
        <div class="sri-icon">${conditionEmoji(data.icon, data.id)}</div>
        <div class="sri-text">
          <div class="sri-city">${data.name}</div>
          <div class="sri-country">${data.country} &middot; ${data.temp}°  ${data.desc}</div>
        </div>
        ${already
          ? '<span style="font-size:12px;color:rgba(255,255,255,0.4)">Added</span>'
          : '<button class="sri-add" id="addBtn">+ Add</button>'
        }
      </div>
    `;
    const addBtn = document.getElementById('addBtn');
    if (addBtn) addBtn.addEventListener('click', () => addCity(pendingSearchResult));
  } catch(e) {
    results.innerHTML = `<div class="search-hint">No results for "${query}".<br>Try a different city name.</div>`;
  }
}

function addCity(c) {
  if (!cities.some(x => x.name === c.name && x.country === c.country)) {
    cities.push(c);
    saveCities();
  }
  showToast(`${c.name} added`);
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '<div class="search-hint">Search for a city to add it to your list and tune the synth.</div>';
  switchView('main');
}

function saveCities() {
  localStorage.setItem('ws_cities', JSON.stringify(cities));
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── Audio engine ─────────────────────────────────────────────────────────────

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.7, audioCtx.currentTime);
  reverbNode = createReverb();
  reverbNode.connect(masterGain);
  masterGain.connect(audioCtx.destination);
}

function createReverb() {
  const convolver = audioCtx.createConvolver();
  const length = audioCtx.sampleRate * 3.5;
  const buf = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
    }
  }
  convolver.buffer = buf;
  return convolver;
}

function tuneToWeather(c) {
  const windCutoff = Math.max(100, Math.min(4000, 200 + c.wind * 80));
  const windQ = Math.max(1, Math.min(18, 2 + c.wind * 0.8));
  const padHarm = Math.round(2 + (c.humidity / 100) * 10);
  const rainDensity = Math.max(0.1, c.clouds / 40);

  params.wind.cutoff = windCutoff;
  params.wind.Q = windQ;
  params.pad.harmonics = padHarm;
  params.rain.density = rainDensity;

  if (isPlaying) { stopSynth(); startSynth(); }
}

function togglePlay() {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  isPlaying = !isPlaying;
  const btn = document.getElementById('playBtn');
  const label = document.getElementById('playLabel');

  if (isPlaying) {
    startSynth();
    btn.classList.add('playing');
    label.textContent = 'Stop';
  } else {
    stopSynth();
    btn.classList.remove('playing');
    label.textContent = 'Play';
  }
  renderCityList();
}

function setParam(layer, key, val) {
  params[layer][key] = parseFloat(val);
  if (isPlaying) updateLiveSynth(layer);
}

function setMasterVolume(val) {
  if (masterGain) masterGain.gain.setTargetAtTime(parseFloat(val), audioCtx.currentTime, 0.05);
}

function tempToFreq(temp) {
  const clamped = Math.max(-20, Math.min(45, temp));
  const t = (clamped + 20) / 65;
  const notes = [65.41, 73.42, 82.41, 87.31, 98.00, 110.00, 130.81, 146.83];
  const idx = Math.floor(t * (notes.length - 1));
  const frac = (t * (notes.length - 1)) - idx;
  const f0 = notes[Math.min(idx, notes.length - 1)];
  const f1 = notes[Math.min(idx + 1, notes.length - 1)];
  return f0 + (f1 - f0) * frac;
}

function startSynth() {
  if (!activeCity) return;
  startDrone(activeCity.temp);
  startWind(activeCity.wind);
  startPad(activeCity.humidity, activeCity.temp);
  startRain(activeCity.clouds);
}

function startDrone(temp) {
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(params.drone.mix * 0.35, audioCtx.currentTime + 2);

  const dry = audioCtx.createGain(); dry.gain.value = 0.7;
  const wet = audioCtx.createGain(); wet.gain.value = 0.3;
  g.connect(dry); dry.connect(masterGain);
  g.connect(wet); wet.connect(reverbNode);

  const freq = tempToFreq(temp);
  const oscs = [];

  const fmCarrier = audioCtx.createOscillator();
  const fmMod = audioCtx.createOscillator();
  const fmGain = audioCtx.createGain();
  fmMod.frequency.value = freq * params.drone.fmRatio;
  fmGain.gain.value = freq * 1.5;
  fmMod.connect(fmGain);
  fmGain.connect(fmCarrier.frequency);
  fmCarrier.frequency.value = freq;
  fmCarrier.type = 'sine';

  const sub = audioCtx.createOscillator();
  sub.frequency.value = freq * 0.5;
  sub.type = 'sine';
  const subGain = audioCtx.createGain(); subGain.gain.value = 0.5;
  sub.connect(subGain);

  const fifth = audioCtx.createOscillator();
  fifth.frequency.value = freq * 1.5;
  fifth.type = 'triangle';
  fifth.detune.value = params.drone.detune;
  const fifthGain = audioCtx.createGain(); fifthGain.gain.value = 0.25;
  fifth.connect(fifthGain);

  const lfoVib = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfoVib.frequency.value = 0.4 + Math.random() * 0.3;
  lfoVib.type = 'sine';
  lfoGain.gain.value = 3;
  lfoVib.connect(lfoGain);
  lfoGain.connect(fmCarrier.frequency);
  lfoGain.connect(fifth.frequency);

  fmCarrier.connect(g); subGain.connect(g); fifthGain.connect(g);
  [fmCarrier, fmMod, sub, fifth, lfoVib].forEach(o => o.start());
  oscs.push(fmCarrier, fmMod, sub, fifth, lfoVib);

  droneNodes = { gain: g, oscs };
}

function startWind(windSpeed) {
  const bufSize = audioCtx.sampleRate * 2;
  const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;

  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;

  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(params.wind.cutoff, audioCtx.currentTime);
  bp.Q.setValueAtTime(params.wind.Q, audioCtx.currentTime);

  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 80;

  const g = audioCtx.createGain();
  const targetMix = windSpeed > 0.5 ? params.wind.mix * 0.25 : 0.01;
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(targetMix, audioCtx.currentTime + 3);

  const lfo = audioCtx.createOscillator();
  const lfoG = audioCtx.createGain();
  lfo.frequency.value = 0.1 + windSpeed * 0.05;
  lfoG.gain.value = params.wind.cutoff * 0.3;
  lfo.connect(lfoG); lfoG.connect(bp.frequency);
  lfo.start();

  src.connect(hp); hp.connect(bp); bp.connect(g);
  const wet = audioCtx.createGain(); wet.gain.value = 0.4;
  g.connect(masterGain); g.connect(wet); wet.connect(reverbNode);
  src.start();

  windNodes = { src, filter: bp, gain: g, lfo };
}

function startPad(humidity, temp) {
  const freq = tempToFreq(temp) * 2;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(params.pad.mix * 0.2, audioCtx.currentTime + 4);

  const wet = audioCtx.createGain(); wet.gain.value = 0.6;
  g.connect(wet); wet.connect(reverbNode);
  g.connect(masterGain);

  const oscs = [];
  const numH = params.pad.harmonics;
  for (let h = 1; h <= numH; h++) {
    const o = audioCtx.createOscillator();
    const og = audioCtx.createGain();
    o.frequency.value = freq * h;
    o.type = h === 1 ? 'sine' : (h % 2 === 0 ? 'sine' : 'triangle');
    og.gain.value = (1 / h) * (humidity / 100) * 0.4;
    o.detune.value = (Math.random() - 0.5) * 8;

    const shimLFO = audioCtx.createOscillator();
    const shimG = audioCtx.createGain();
    shimLFO.frequency.value = 0.2 + Math.random() * 0.5;
    shimG.gain.value = params.pad.shimmer * 5;
    shimLFO.connect(shimG); shimG.connect(o.frequency);
    shimLFO.start(); oscs.push(shimLFO);

    o.connect(og); og.connect(g);
    o.start(); oscs.push(o);
  }
  padNodes = { gain: g, oscs };
}

function startRain(cloudCover) {
  rainTimeout = null;
  const density = params.rain.density;
  const interval = Math.max(80, 500 / density) * (0.5 + Math.random());

  function scheduleRaindrop() {
    if (!isPlaying) return;
    const t = audioCtx.currentTime;
    const freq = params.rain.pitch * (0.5 + Math.random() * 1.5);

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 3;

    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.15);

    const vol = params.rain.mix * 0.3 * (cloudCover / 100) * (0.3 + Math.random() * 0.7);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

    const pan = audioCtx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.5;

    const wet = audioCtx.createGain(); wet.gain.value = 0.5;
    o.connect(filt); filt.connect(g); g.connect(pan);
    pan.connect(masterGain); pan.connect(wet); wet.connect(reverbNode);

    o.start(t); o.stop(t + 0.3);
    rainTimeout = setTimeout(scheduleRaindrop, interval);
  }

  if (cloudCover > 10) scheduleRaindrop();
}

function stopSynth() {
  const t = audioCtx.currentTime;
  const fadeTime = 0.08;  // short time constant = quick but still smooth, no click
  const stopDelay = 400;  // ms: enough time for fade to finish before killing oscillators

  if (droneNodes) {
    droneNodes.gain.gain.cancelScheduledValues(t);
    droneNodes.gain.gain.setTargetAtTime(0, t, fadeTime);
    const nodes = droneNodes;
    setTimeout(() => { try { nodes.oscs.forEach(o => o.stop()); } catch(e){} }, stopDelay);
    droneNodes = null;
  }
  if (windNodes) {
    windNodes.gain.gain.cancelScheduledValues(t);
    windNodes.gain.gain.setTargetAtTime(0, t, fadeTime);
    const nodes = windNodes;
    setTimeout(() => { try { nodes.src.stop(); nodes.lfo.stop(); } catch(e){} }, stopDelay);
    windNodes = null;
  }
  if (padNodes) {
    padNodes.gain.gain.cancelScheduledValues(t);
    padNodes.gain.gain.setTargetAtTime(0, t, fadeTime);
    const nodes = padNodes;
    setTimeout(() => { try { nodes.oscs.forEach(o => o.stop()); } catch(e){} }, stopDelay);
    padNodes = null;
  }
  if (rainTimeout) { clearTimeout(rainTimeout); rainTimeout = null; }
}

function updateLiveSynth(layer) {
  if (!isPlaying) return;
  const t = audioCtx.currentTime;
  if (layer === 'wind' && windNodes) {
    windNodes.filter.frequency.setTargetAtTime(params.wind.cutoff, t, 0.1);
    windNodes.filter.Q.setTargetAtTime(params.wind.Q, t, 0.1);
    windNodes.gain.gain.setTargetAtTime(params.wind.mix * 0.25, t, 0.1);
  }
  if (layer === 'drone' && droneNodes) {
    droneNodes.gain.gain.setTargetAtTime(params.drone.mix * 0.35, t, 0.1);
  }
  if (layer === 'pad' && padNodes) {
    padNodes.gain.gain.setTargetAtTime(params.pad.mix * 0.2, t, 0.1);
  }
  if (layer === 'rain') {
    if (rainTimeout) { clearTimeout(rainTimeout); rainTimeout = null; }
    if (isPlaying && activeCity) startRain(activeCity.clouds);
  }
}

// ─── Canvas visualizer ────────────────────────────────────────────────────────

const canvas = document.getElementById('viz');
const ctx2d   = canvas.getContext('2d');
let vizPhase  = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (w === 0 || h === 0) return;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

function drawViz() {
  requestAnimationFrame(drawViz);
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  if (W === 0 || H === 0) return;
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = 'rgba(0,0,0,0.15)';
  ctx2d.fillRect(0, 0, W, H);

  vizPhase += 0.008;
  const c = activeCity;
  const temp  = c ? c.temp  : 20;
  const wind  = c ? c.wind  : 5;
  const hum   = c ? c.humidity : 60;

  const t = (Math.max(-20, Math.min(45, temp)) + 20) / 65;
  const r = Math.round(251 * t + 56  * (1-t));
  const g = Math.round(191 * t + 189 * (1-t));
  const b = Math.round(36  * t + 212 * (1-t));

  for (let w = 0; w < 3; w++) {
    ctx2d.beginPath();
    const amp    = 8 + (wind / 30) * 14 + w * 3;
    const freq2  = 0.018 + w * 0.004;
    const phase  = vizPhase * (1 + w * 0.35) + w * 1.1;
    const yBase  = H * 0.35 + w * H * 0.18;
    const alpha  = 0.25 + (hum / 100) * 0.35 + (isPlaying ? 0.2 : 0);

    ctx2d.strokeStyle = w < 2
      ? `rgba(${r},${g},${b},${alpha})`
      : `rgba(167,139,250,${alpha})`;
    ctx2d.lineWidth = 1.2;

    for (let x = 0; x <= W; x += 2) {
      const y = yBase
        + Math.sin(x * freq2 + phase) * amp
        + Math.sin(x * freq2 * 1.6 + phase * 0.85) * amp * 0.4;
      if (x === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }

  if (isPlaying) {
    const bars = 32;
    const bw = W / bars - 0.5;
    for (let i = 0; i < bars; i++) {
      const t2 = i / bars;
      const ht = 4 + Math.sin(t2 * Math.PI * 5 + vizPhase * 5) * 7
                   + Math.sin(t2 * Math.PI * 2.3 + vizPhase * 3) * 5;
      const hh = Math.max(1, ht);
      const x = i * (W / bars);
      const a2 = 0.5 + 0.3 * Math.sin(i * 0.6 + vizPhase * 4);
      ctx2d.fillStyle = i % 3 === 0
        ? `rgba(125,211,252,${a2})`
        : i % 3 === 1
        ? `rgba(167,139,250,${a2})`
        : `rgba(251,191,36,${a2 * 0.7})`;
      ctx2d.fillRect(x, H - hh - 2, bw, hh);
    }
  }
}

drawViz();

// ─── Search: handle enter key ─────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch(e.target.value.trim());
});

// ─── Init ─────────────────────────────────────────────────────────────────────

renderCityList();