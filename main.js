let audioCtx;
let isPlaying = false;

// Synth Components
let windNoise, windFilter, windGain;
let tempOsc, tempGain;

const setupAudio = () => {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 1. WIND GENERATOR (Subtractive Synthesis)
    // Create White Noise
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    windNoise = audioCtx.createBufferSource();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;

    // Filter to shape the noise into "wind"
    windFilter = audioCtx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.Q.value = 10;

    windGain = audioCtx.createGain();
    windGain.gain.value = 0.2;

    // Routing: Noise -> Filter -> Gain -> Destination
    windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(audioCtx.destination);
    windNoise.start();

    // 2. TEMPERATURE TONE (Additive/Sine Synthesis)
    tempOsc = audioCtx.createOscillator();
    tempOsc.type = 'sine';
    tempGain = audioCtx.createGain();
    tempGain.gain.value = 0; // Start silent

    tempOsc.connect(tempGain);
    tempGain.connect(audioCtx.destination);
    tempOsc.start();
};

const updateSynth = (data) => {
    const temp = data.main.temp;       // Celsius
    const windSpeed = data.wind.speed; // m/s
    const humidity = data.main.humidity; // %

    // MAP WIND SPEED -> Filter Frequency
    // Higher wind speed = higher whistling frequency
    const windFreq = 200 + (windSpeed * 150);
    windFilter.frequency.setTargetAtTime(windFreq, audioCtx.currentTime, 1);

    // MAP TEMPERATURE -> Pitch
    // We'll use a simple mapping: Temp + 200Hz
    const pitch = 220 + (temp * 5); 
    tempOsc.frequency.setTargetAtTime(pitch, audioCtx.currentTime, 1);
    
    // MAP HUMIDITY -> Volume of the tone
    const volume = humidity / 500; // Normalized
    tempGain.gain.setTargetAtTime(volume, audioCtx.currentTime, 1);

    document.getElementById('weatherDisplay').innerText = 
        `Temp: ${temp}°C | Wind: ${windSpeed}m/s | Humid: ${humidity}%`;
};

// API Fetching
const fetchWeather = async (city) => {
    const API_KEY = '3c23559b0257e7facbe7ba782a600109';
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.cod === 200) {
            updateSynth(data);
        } else {
            alert("City not found!");
        }
    } catch (err) {
        console.error("Fetch error:", err);
    }
};

document.getElementById('startBtn').addEventListener('click', () => {
    if (!audioCtx) setupAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const city = document.getElementById('cityInput').value || 'New York';
    fetchWeather(city);
});