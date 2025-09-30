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
    function ensureAudioContext() {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        mainGain = audioContext.createGain();
        mainGain.gain.value = 0.8;
        mainGain.connect(audioContext.destination);
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => { audioEnabled = true; });
      } else {
        audioEnabled = true;
      }
      return audioContext;
    }

    function enableAudio() {
      const ctx = ensureAudioContext();
      // tiny silent tick to unlock on some browsers
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.05);
      audioEnabled = true;
    }

    function enableAudioManually() {
      enableAudio();
      setTimeout(() => { playRingtone('chime'); }, 100);
      const notice = document.getElementById('audioNotice');
      if (notice) notice.style.display = 'none';
      alert('Audio enabled. Alarms can play sounds now.');
    }

    // ====== Built-in tones via Web Audio ======
    function createTone(freq, dur, type='sine', vol=0.4){
      if (!audioEnabled) enableAudio();
      const ctx = ensureAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
      osc.connect(gain); gain.connect(mainGain);
      osc.start(); osc.stop(ctx.currentTime + dur);
    }

    function playRingtone(kind){
      if (!audioEnabled) enableAudio();
      stopCurrentBuffer(); // ensure custom buffer stops when testing tones
      switch(kind){
        case 'beep': for(let i=0;i<3;i++) setTimeout(()=>createTone(800,.25), i*350); break;
        case 'chime': createTone(523.25,.5); setTimeout(()=>createTone(659.25,.5),250); setTimeout(()=>createTone(783.99,.8),500); break;
        case 'buzz': for(let i=0;i<5;i++) setTimeout(()=>createTone(200,.15,'sawtooth'), i*180); break;
        case 'melody': [523.25,587.33,659.25,698.46,783.99].forEach((f,i)=>setTimeout(()=>createTone(f,.3), i*250)); break;
        case 'alert': for(let i=0;i<6;i++) setTimeout(()=>createTone(1000,.12), i*120); break;
        case 'bell': createTone(440,1.0); setTimeout(()=>createTone(440,.9),1000); break;
        case 'bird': for(let i=0;i<4;i++) setTimeout(()=>createTone(800+Math.random()*400,.25), i*280); break;
        case 'ocean': for(let i=0;i<8;i++) setTimeout(()=>createTone(100+Math.random()*200,.3,'sawtooth'), i*140); break;
      }
    }

    // ====== Custom song decoding & playback (Web Audio) ======
    async function decodeFileToBuffer(file){
      if (!audioEnabled) enableAudio();
      const ctx = ensureAudioContext();
      const arrayBuf = await file.arrayBuffer();
      // Promise or callback form for Safari compatibility
      if (ctx.decodeAudioData.length === 1) {
        return await ctx.decodeAudioData(arrayBuf);
      }
      return new Promise((resolve, reject) => {
        ctx.decodeAudioData(arrayBuf, resolve, reject);
      });
    }

    function playBuffer(buffer, loop=false){
      if (!audioEnabled) enableAudio();
      const ctx = ensureAudioContext();
      stopCurrentBuffer();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = loop;
      src.connect(mainGain);
      src.start();
      currentBufferSource = src;
      return src;
    }

    function stopCurrentBuffer(){
      if (currentBufferSource){
        try { currentBufferSource.stop(); } catch(e){}
        try { currentBufferSource.disconnect(); } catch(e){}
        currentBufferSource = null;
      }
    }

    // preview helpers
    function stopPreview(){
      if (previewBufferSource){
        try { previewBufferSource.stop(); } catch(e){}
        try { previewBufferSource.disconnect(); } catch(e){}
        previewBufferSource = null;
      }
      const playBtn = document.getElementById('playBtn');
      const stopBtn = document.getElementById('stopBtn');
      if (playBtn && stopBtn){ playBtn.style.display='inline-block'; stopBtn.style.display='none'; }
    }

    async function previewSelectedFile(){
      const fileInput = document.getElementById('audioFile');
      if (!(fileInput && fileInput.files && fileInput.files[0])) return;
      try{
        const buffer = await decodeFileToBuffer(fileInput.files[0]);
        stopPreview();
        previewBufferSource = playBuffer(buffer, false);
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        if (playBtn && stopBtn){ playBtn.style.display='none'; stopBtn.style.display='inline-block'; }
        previewBufferSource.onended = () => stopPreview();
      }catch(err){
        console.log('Preview decode/play failed:', err);
        alert('Cannot decode this file. Use MP3, WAV, OGG, or AAC-LC (.m4a not Lossless).');
      }
    }

    // ====== UI helpers ======
    function updateCurrentTime(){
      const now = new Date();
      const timeString = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
      document.getElementById('currentTime').textContent = timeString;
    }

    function calculateEndTime(startTime, durationMinutes){
      const [h,m] = startTime.split(':').map(Number);
      const total = h*60 + m + durationMinutes;
      const endH = Math.floor(total/60)%24;
      const endM = total%60;
      return `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
    }

    function updateEndTime(){
      const startTime = document.getElementById('alarmTime').value;
      const duration = parseInt(document.getElementById('durationMinutes').value) || 15;
      const isTimed = document.getElementById('timedAlarm').checked;
      if (startTime && isTimed){
        document.getElementById('endTime').value = calculateEndTime(startTime, duration);
      }
    }

    function formatTime(t24){
      const [hh,mm] = t24.split(':').map(n=>parseInt(n,10));
      const h12 = hh % 12 || 12;
      const ampm = hh < 12 ? 'AM' : 'PM';
      return `${h12}:${String(mm).padStart(2,'0')} ${ampm}`;
    }

    function getRingtoneName(r){
      const names = {beep:'Classic Beep',chime:'Gentle Chime',buzz:'Phone Buzz',melody:'Happy Melody',alert:'Alert Sound',bell:'Church Bell',bird:'Bird Chirping',ocean:'Ocean Waves'};
      return names[r] || r;
    }

    function handleFileSelection(){
      const fileInput = document.getElementById('audioFile');
      const preview = document.getElementById('filePreview');
      const fileName = document.getElementById('fileName');
      if (fileInput.files && fileInput.files[0]){
        fileName.textContent = `File: ${fileInput.files[0].name}`;
        preview.style.display = 'block';
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        if (playBtn && stopBtn){ playBtn.style.display='inline-block'; stopBtn.style.display='none'; }
        stopPreview();
      } else {
        preview.style.display = 'none';
        stopPreview();
      }
    }

    // ====== Alarms CRUD ======
    function addAlarm(){
      const time = document.getElementById('alarmTime').value;
      const label = document.getElementById('alarmLabel').value.trim();
      const ringtone = document.getElementById('ringtoneSelect').value;
      const isTimed = document.getElementById('timedAlarm').checked;
      const duration = isTimed ? (parseInt(document.getElementById('durationMinutes').value)||15) : null;

      if (!time){ alert('Please select a start time.'); return; }
      if (!label){ alert('Please enter an alarm label.'); return; }

      const alarm = {
        id: Date.now(),
        time, label, ringtone,
        active: true,
        isTimed, duration,
        endTime: isTimed ? calculateEndTime(time, duration) : null,
        // customBuffer holds an AudioBuffer during this session
        customBuffer: null,
        customFileName: null
      };

      if (ringtone === 'custom'){
        const fileInput = document.getElementById('audioFile');
        if (!(fileInput && fileInput.files && fileInput.files[0])){
          alert('Please select an audio file for the custom ringtone.');
          return;
        }
        const file = fileInput.files[0];

        // Decode once and store buffer (no <audio>, no blobs)
        decodeFileToBuffer(file).then(buffer=>{
          alarm.customBuffer = buffer;
          alarm.customFileName = file.name;
          alarms.push(alarm);
          saveAlarms();
          renderAlarms();
          clearForm();
          alert('Custom alarm created. Your song will play when the alarm triggers.');
        }).catch(err=>{
          console.log('Decode failed:', err);
          alert('This file could not be decoded. Use MP3, WAV, OGG, or AAC-LC (.m4a not Lossless).');
        });
        return;
      }

      alarms.push(alarm);
      saveAlarms();
      renderAlarms();
      clearForm();
      alert('Alarm created.');
    }

    function clearForm(){
      document.getElementById('alarmTime').value='';
      document.getElementById('alarmLabel').value='';
      document.getElementById('timedAlarm').checked=false;
      document.getElementById('durationSection').style.display='none';
      document.getElementById('ringtoneSelect').value='beep';
      const fi = document.getElementById('audioFile');
      if (fi) fi.value='';

      const preview = document.getElementById('filePreview');
      if (preview) preview.style.display='none';
      stopPreview();
    }

    function deleteAlarm(id){
      if (playingAlarms.has(id)) stopSpecificAlarm(id);
      alarms = alarms.filter(a => a.id !== id);
      saveAlarms();
      renderAlarms();
    }

    function toggleAlarm(id){
      const alarm = alarms.find(a=>a.id===id);
      if (!alarm) return;
      alarm.active = !alarm.active;
      if (!alarm.active && playingAlarms.has(id)) stopSpecificAlarm(id);
      saveAlarms();
      renderAlarms();
    }

    function reuploadFile(alarmId){
      const alarm = alarms.find(a=>a.id===alarmId);
      if (!alarm) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/mp3,audio/mpeg,audio/wav,audio/ogg,audio/m4a,audio/aac,.mp3,.wav,.ogg,.m4a,.aac';
      input.onchange = async (e)=>{
        const file = e.target.files[0];
        if (!file) return;
        try{
          const buffer = await decodeFileToBuffer(file);
          alarm.customBuffer = buffer;
          alarm.customFileName = file.name;
          alarm.needsReupload = false;
          saveAlarms();
          renderAlarms();
          alert('File re-uploaded successfully.');
        }catch(err){
          console.log('Reupload decode failed:', err);
          alert('Could not decode this file. Use MP3, WAV, OGG, or AAC-LC (.m4a not Lossless).');
        }
      };
      input.click();
    }

    // ====== Render ======
    function renderAlarms(){
      const container = document.getElementById('alarmsList');
      if (!alarms.length){
        container.innerHTML = '<div class="empty-state">No alarms set yet. Create your first alarm above.</div>';
        return;
      }
      container.innerHTML = alarms.map(alarm=>{
        const isPlaying = playingAlarms.has(alarm.id);
        const needsReupload = alarm.ringtone === 'custom' && (!alarm.customBuffer || alarm.needsReupload);
        const audioSource = alarm.ringtone === 'custom'
          ? (needsReupload ? `Custom: ${alarm.customFileName || 'File needs re-upload'}` : `Custom: ${alarm.customFileName || 'Uploaded Song'}`)
          : getRingtoneName(alarm.ringtone);

        return `
          <div class="alarm-item ${alarm.isTimed ? 'timed-alarm':''} ${needsReupload ? 'needs-reupload':''}">
            <div class="alarm-header">
              <div class="alarm-time">${formatTime(alarm.time)}</div>
              ${alarm.isTimed ? `<div class="alarm-duration">Plays for ${alarm.duration} min (until ${formatTime(alarm.endTime)})</div>` : ''}
            </div>
            <div class="alarm-details">${alarm.label}</div>
            <div class="alarm-sound">Sound: ${audioSource}</div>
            ${needsReupload ? '<div style="color:#ffeb3b;font-size:.9em;margin:10px 0;">Please re-upload your custom song file</div>' : ''}
            <div class="alarm-controls">
              <span class="status ${isPlaying ? 'playing' : (alarm.active ? 'active' : 'inactive')}">
                ${isPlaying ? 'Playing' : (alarm.active ? 'Active' : 'Inactive')}
              </span>
              ${
                isPlaying
                  ? `<button class="btn btn-small btn-danger" onclick="stopSpecificAlarm(${alarm.id})">Stop</button>`
                  : needsReupload
                    ? `<button class="btn btn-small btn-play" onclick="reuploadFile(${alarm.id})">Re-upload</button>`
                    : `<button class="btn btn-small btn-play" onclick="testAlarm(${alarm.id})">Test</button>`
              }
              <button class="btn btn-small ${alarm.active ? 'btn-danger' : 'btn-success'}" onclick="toggleAlarm(${alarm.id})">
                ${alarm.active ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-small btn-danger" onclick="deleteAlarm(${alarm.id})">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    }

    // ====== Alarm logic ======
    function testCurrentRingtone(){
      const ringtone = document.getElementById('ringtoneSelect').value;
      if (ringtone === 'custom'){
        const fileInput = document.getElementById('audioFile');
        if (fileInput && fileInput.files && fileInput.files[0]){
          previewSelectedFile();
        } else {
          alert('Please select an audio file first.');
        }
      } else {
        playRingtone(ringtone);
      }
    }

    function testAlarm(alarmId){
      const alarm = alarms.find(a=>a.id===alarmId);
      if (!alarm) return;
      if (alarm.ringtone === 'custom'){
        if (alarm.customBuffer && !alarm.needsReupload){
          playBuffer(alarm.customBuffer, false);
        } else {
          alert('Please re-upload the custom audio file first.');
        }
      } else {
        playRingtone(alarm.ringtone);
      }
    }

    function stopSpecificAlarm(alarmId){
      playingAlarms.delete(alarmId);
      stopCurrentBuffer();
      renderAlarms();
    }

    function startTimedAlarm(alarm){
      playingAlarms.add(alarm.id);
      if (alarm.ringtone === 'custom' && alarm.customBuffer && !alarm.needsReupload){
        playBuffer(alarm.customBuffer, true);
      } else if (alarm.ringtone === 'custom'){
        // Fallback to built-in beep loop
        playRingtone('beep');
        const again = () => { if (playingAlarms.has(alarm.id)) { playRingtone('beep'); setTimeout(again, 3000); } };
        setTimeout(again, 3000);
        alert(`Alarm "${alarm.label}" triggered but custom audio needs re-upload. Playing backup beep.`);
      } else {
        playRingtone(alarm.ringtone);
        const again = () => { if (playingAlarms.has(alarm.id)) { playRingtone(alarm.ringtone); setTimeout(again, 3000); } };
        setTimeout(again, 3000);
      }
      renderAlarms();
    }

    function triggerAlarm(alarm){
      activeAlarmId = alarm.id;
      playingAlarms.add(alarm.id);
      document.getElementById('alarmMessage').textContent = `${alarm.label} - ${formatTime(alarm.time)}`;
      document.getElementById('alarmModal').style.display = 'flex';

      if (alarm.ringtone === 'custom' && alarm.customBuffer && !alarm.needsReupload){
        playBuffer(alarm.customBuffer, true);
      } else if (alarm.ringtone === 'custom'){
        playRingtone('beep');
        const again = () => { if (activeAlarmId === alarm.id) { playRingtone('beep'); setTimeout(again, 2000); } };
        setTimeout(again, 2000);
        document.getElementById('alarmMessage').textContent =
          `${alarm.label} - ${formatTime(alarm.time)} (Custom audio needs re-upload)`;
      } else {
        playRingtone(alarm.ringtone);
        const again = () => { if (activeAlarmId === alarm.id) { playRingtone(alarm.ringtone); setTimeout(again, 2000); } };
        setTimeout(again, 2000);
      }
    }

    function dismissAlarm(){
      stopCurrentBuffer();
      if (activeAlarmId !== null) playingAlarms.delete(activeAlarmId);
      document.getElementById('alarmModal').style.display = 'none';
      activeAlarmId = null;
      renderAlarms();
    }

    function stopPlaying(){ dismissAlarm(); }

    function snoozeAlarm(){
      if (activeAlarmId){
        const alarm = alarms.find(a=>a.id===activeAlarmId);
        if (alarm){
          const [h,m] = alarm.time.split(':').map(Number);
          const newM = (m+5)%60;
          const newH = newM < m ? (h+1)%24 : h;
          alarm.time = `${String(newH).padStart(2,'0')}:${String(newM).padStart(2,'0')}`;
          if (alarm.isTimed){ alarm.endTime = calculateEndTime(alarm.time, alarm.duration); }
          alarm.triggered = false;
          saveAlarms();
          renderAlarms();
        }
      }
      dismissAlarm();
    }

    function checkAlarms(){
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      alarms.forEach(alarm=>{
        if (!alarm.active) return;
        const isPlaying = playingAlarms.has(alarm.id);

        if (alarm.isTimed){
          if (alarm.time === currentTime && !isPlaying && !alarm.triggered){
            startTimedAlarm(alarm);
            alarm.triggered = true;
          } else if (alarm.endTime === currentTime && isPlaying){
            stopSpecificAlarm(alarm.id);
            alarm.triggered = false;
          } else if (alarm.time !== currentTime && alarm.endTime !== currentTime){
            alarm.triggered = false;
          }
        } else {
          if (alarm.time === currentTime && !alarm.triggered){
            triggerAlarm(alarm);
            alarm.triggered = true;
          } else if (alarm.time !== currentTime){
            alarm.triggered = false;
          }
        }
      });
    }

    // ====== Persistence (metadata only) ======
    function saveAlarms(){
      const toSave = alarms.map(alarm=>{
        const copy = { ...alarm };
        if (copy.customBuffer){ // cannot persist AudioBuffer
          delete copy.customBuffer;
          copy.needsReupload = true;
        }
        return copy;
      });
      try{
        localStorage.setItem('customAlarms', JSON.stringify(toSave));
      }catch(e){
        console.error('Could not save alarms:', e);
        alert('Storage is full. Your alarms will work for this session only.');
      }
    }

    function loadAlarms(){
      const saved = localStorage.getItem('customAlarms');
      if (!saved) return;
      try{ alarms = JSON.parse(saved); } catch(e){ alarms = []; }
    }

    // ====== Init ======
    window.addEventListener('load', function(){
      document.getElementById('timedAlarm').addEventListener('change', function(){
        const durationSection = document.getElementById('durationSection');
        durationSection.style.display = this.checked ? 'block' : 'none';
        if (this.checked) updateEndTime();
      });
      document.getElementById('alarmTime').addEventListener('change', updateEndTime);
      document.getElementById('durationMinutes').addEventListener('input', updateEndTime);

      document.getElementById('ringtoneSelect').addEventListener('change', function(){
        const customUpload = document.getElementById('customUpload');
        customUpload.style.display = this.value === 'custom' ? 'block' : 'none';
      });

      document.getElementById('audioFile').addEventListener('change', handleFileSelection);

      // One-time gesture unlock
      document.addEventListener('click', ()=>{ if (!audioEnabled) enableAudio(); }, { once: true });
      document.addEventListener('touchstart', ()=>{ if (!audioEnabled) enableAudio(); }, { once: true });

      loadAlarms();
      updateCurrentTime();
      renderAlarms();

      setInterval(updateCurrentTime, 1000);
      setInterval(checkAlarms, 1000);
    });