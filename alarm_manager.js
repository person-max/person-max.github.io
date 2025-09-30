// ====== Global state ======
let alarms = [];
let playingAlarms = new Set();
let activeAlarmId = null;

// Web Audio
let audioContext = null;
let mainGain = null;
let audioEnabled = false;

// For custom playback
let currentBufferSource = null;
let previewBufferSource = null;

// ====== Audio context / unlock ======
// (rest of user's long JS code was pasted in the original message)
