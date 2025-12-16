let mapLight = null;
let mapDark = null;
let map = null;


let lastBeepTime = 0;
const BEEP_COOLDOWN = 300;  // Milliseconds between beeps


let lastCameraModalShown = null;  // Track which camera modal was shown


let userMarker = null;
let userMarkerDark = null;
let cameras = [];
let cameraMarkers = [];
let warningCircles = [];
let detectionCircles = [];
let watchId = null;
let lastPosition = null;
let lastPositionTime = null;
let sunTimesComputed = false;
let userManuallyToggledTheme = false;



let manualPan = false;



let segmentTotalDistance = 0;
let segmentTotalTime = 0;
let liveAvgSpeed = 0;  // Changed from null to 0



let firstCamera = null;
let lastCameraNameShown = null;
let lastCompletedSegmentSpeed = null;
let lastCompletedSegmentStatus = null;
let isInActiveSegment = false;



let pathLine = null;
let pathCoordinates = [];



let segmentStartTime = null;
let segmentStartPosition = null;



let elCurrentSpeed, elAvgSpeed, elStatus, elCameraText;



function setStatus(text) { if (elStatus) elStatus.textContent = text; }
function setCameraText(text) { if (elCameraText) elCameraText.textContent = text; }
function setCurrentSpeed(kmh) { if (elCurrentSpeed) elCurrentSpeed.textContent = Math.round(kmh); }
function setAvgSpeed(kmh) { if (elAvgSpeed) elAvgSpeed.textContent = Math.round(kmh); }



let currentMapTheme = 'light';



const MAP_ID_LIGHT = '9c4e44f9d3c1579dea6c2530';
const MAP_ID_DARK = '9c4e44f9d3c1579daf77b83a';



let currentMapCenter = { lat: 42.6977, lng: 23.3219 };
let currentMapZoom = 16;



function getSunTimes(date, lat, lng) {
  const rad = Math.PI / 180;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const dayMs = 1000 * 60 * 60 * 24;



  function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
  }
  function fromJulian(j) {
    return new Date((j + 0.5 - J1970) * dayMs);
  }
  function solarMeanAnomaly(d) {
    return rad * (357.5291 + 0.98560028 * d);
  }
  function eclipticLongitude(M) {
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = rad * 102.9372;
    return M + C + P + Math.PI;
  }
  function julianCycle(d, lw) {
    return Math.round(d - 0.0009 - lw / (2 * Math.PI));
  }
  function solarTransitJ(ds, M, L) {
    return 2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  }
  function hourAngle(h, phi, d) {
    return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
  }
  function declination(L, b) {
    const e = rad * 23.4397;
    return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(L));
  }



  const lw = -lng * rad;
  const phi = lat * rad;
  const d = toJulian(date) - J2000;
  const n = julianCycle(d, lw);
  const ds = n - 0.0009 - lw / (2 * Math.PI);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);



  const h0 = (-0.833) * rad;
  const H0 = hourAngle(h0, phi, dec);
  const Jrise = Jnoon - H0 / (2 * Math.PI);
  const Jset = Jnoon + H0 / (2 * Math.PI);



  return {
    sunrise: fromJulian(Jrise),
    sunset: fromJulian(Jset),
  };
}



function showToast(message, type = 'warning') {
  const toast = document.createElement('div');
  toast.textContent = message;
  const bgColor = type === 'danger' ? '#d33' : '#FFA500';
  toast.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: ' + bgColor + '; color: white; padding: 12px 24px; border-radius: 8px; z-index: 9999; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), type === 'danger' ? 5000 : 3000);
}


let audioCtx = null;
function beep(freq = 700, duration = 400) {
  // Prevent rapid-fire beeps
  const now = Date.now();
  if (now - lastBeepTime < BEEP_COOLDOWN) return;
  lastBeepTime = now;


  // Create beep using Web Audio API
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.8, audioCtx.currentTime);  // Increased to 0.8 (was 0.4)
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration / 1000);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration / 1000);
}



let modalTimeout = null;
function showWarningModal(camera) {
  // Only show modal once per camera
  if (lastCameraModalShown === camera.id) return;
  lastCameraModalShown = camera.id;
  
  if (modalTimeout) clearTimeout(modalTimeout);
  const modal = document.getElementById('warningModal');
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalCameraName').textContent = camera.name;
  document.getElementById('modalLimitValue').textContent = camera.limit_kmh;



  modal.classList.add('show');
  modal.classList.remove('hidden');
  overlay.classList.add('show');
  overlay.classList.remove('hidden');



  let seconds = 15;
  document.getElementById('countdownSeconds').textContent = seconds;
  modalTimeout = setInterval(() => {
    seconds--;
    document.getElementById('countdownSeconds').textContent = seconds;
    if (seconds <= 0) closeWarningModal();
  }, 1000);



  const close = () => { closeWarningModal(); };
  document.getElementById('closeModalBtn').onclick = close;
  overlay.onclick = close;
}



function closeWarningModal() {
  if (modalTimeout) { clearInterval(modalTimeout); modalTimeout = null; }
  document.getElementById('warningModal').classList.remove('show');
  document.getElementById('warningModal').classList.add('hidden');
  document.getElementById('modalOverlay').classList.remove('show');
  document.getElementById('modalOverlay').classList.add('hidden');
}



function createCameraMarkerContent(speedLimit) {
  const div = document.createElement('div');
  div.style.cssText = 'width: 40px; height: 40px; background: #FF5000; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; font-size: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);';
  div.textContent = speedLimit;
  return div;
}



function createUserMarkerContent(heading) {
  const div = document.createElement('div');
  const rotationCSS = 'width: 20px; height: 28px; background: #00ff00; border: 2px solid white; clip-path: polygon(50% 0%, 100% 75%, 50% 100%, 0% 75%); transform: rotate(' + heading + 'deg); box-shadow: 0 2px 6px rgba(0,0,0,0.3);';
  div.style.cssText = rotationCSS;
  return div;
}



async function initMaps() {
  try {
    const { Map } = await google.maps.importLibrary("maps");
    await google.maps.importLibrary("marker");



    elCurrentSpeed = document.getElementById('currentSpeed');
    elAvgSpeed = document.getElementById('avgSpeed');
    elStatus = document.getElementById('statusText');
    elCameraText = document.getElementById('cameraText');



    const RADIO_URL = 'https://listen.radioking.com/radio/772229/stream/839543';
    window.audio = new Audio(RADIO_URL);
    window.audio.loop = true;



    const mapContainer = document.getElementById('map');
    const darkContainer = document.createElement('div');
    darkContainer.id = 'map-dark';
    darkContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none;';
    mapContainer.parentElement.appendChild(darkContainer);



    const {ColorScheme} = await google.maps.importLibrary("core");


mapLight = new Map(mapContainer, {
  center: currentMapCenter,
  zoom: currentMapZoom,
  mapTypeId: 'roadmap',
  mapId: MAP_ID_LIGHT,
  colorScheme: ColorScheme.LIGHT,
  disableDefaultUI: true,
  gestureHandling: 'greedy',
});


mapDark = new Map(darkContainer, {
  center: currentMapCenter,
  zoom: currentMapZoom,
  mapTypeId: 'roadmap',
  mapId: MAP_ID_DARK,
  colorScheme: ColorScheme.DARK,
  disableDefaultUI: true,
  gestureHandling: 'greedy',
});


    
    // Trigger resize to ensure dark map renders properly when hidden
    setTimeout(() => {
      google.maps.event.trigger(mapDark, 'resize');
    }, 100);



    map = mapLight;



    setupMapListeners(mapLight);
    setupMapListeners(mapDark);



    window.lastHeading = 0;
    setStatus('Requesting GPS...');
    startGeolocation();
    loadCameras();



  } catch (error) {
    console.error('Map initialization failed:', error);
    setStatus('Map failed to load');
  }
}



function setupMapListeners(mapInstance) {
  const recenterBtn = document.getElementById('recenterBtn');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      manualPan = false;
      updateRecenterButton();
      updateMapMode();
    });
  }



  mapInstance.addListener('dragstart', () => {
    manualPan = true;
    updateRecenterButton();
  });
}



function updateMapMode() {
  if (!manualPan && map) {
    let userPos = null;
    if (currentMapTheme === 'light' && userMarker) {
      userPos = userMarker.position;
    } else if (currentMapTheme === 'dark' && userMarkerDark) {
      userPos = userMarkerDark.position;
    }
    if (userPos) {
      map.panTo(userPos);
    }
  }
}



function updateRecenterButton() {
  const btn = document.getElementById('recenterBtn');
  if (manualPan) {
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}



async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    if (!res.ok) throw new Error('Failed');
    cameras = await res.json();



    cameraMarkers.forEach(m => m.map = null);
    warningCircles.forEach(c => c.setMap(null));
    detectionCircles.forEach(c => c.setMap(null));
    cameraMarkers = []; warningCircles = []; detectionCircles = [];



    cameras.forEach(cam => {
      const lat = parseFloat(cam.latitude);
      const lng = parseFloat(cam.longitude);
      
      if (isNaN(lat) || isNaN(lng)) {
        console.warn('Invalid coordinates for camera:', cam.name);
        return;
      }



      const pos = { lat: lat, lng: lng };



      [mapLight, mapDark].forEach(mapInstance => {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: mapInstance,
          title: cam.name + ' – ' + cam.limit_kmh + ' km/h',
          content: createCameraMarkerContent(cam.limit_kmh),
          zIndex: 100,
        });



        if (mapInstance === mapLight) cameraMarkers.push(marker);
      });



      [mapLight, mapDark].forEach(mapInstance => {
        const warn = new google.maps.Circle({
          strokeColor: '#FFA500', strokeOpacity: 0.6, strokeWeight: 2,
          fillColor: '#FFA500', fillOpacity: 0.07,
          map: mapInstance, center: pos, radius: cam.warning_radius_m || 350,
        });
        if (mapInstance === mapLight) warningCircles.push(warn);
      });



      [mapLight, mapDark].forEach(mapInstance => {
        const detect = new google.maps.Circle({
          strokeColor: '#FF0000', strokeOpacity: 0.8, strokeWeight: 3,
          fillColor: '#FF0000', fillOpacity: 0.15,
          map: mapInstance, center: pos, radius: cam.detection_radius_m || 60, zIndex: 1000,
        });
        if (mapInstance === mapLight) detectionCircles.push(detect);
      });
    });



    console.log('Loaded ' + cameras.length + ' cameras on both maps');
  } catch (err) {
    console.error('Cameras load error:', err);
    setCameraText('No cameras');
  }
}



function startGeolocation() {
  if (!navigator.geolocation) {
    setStatus('GPS not supported');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    onPosition,
    err => setStatus('GPS error: ' + err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}



function onPosition(position) {
  const { latitude, longitude, speed, heading } = position.coords;
  const latLng = { lat: latitude, lng: longitude };



  if (!sunTimesComputed && !userManuallyToggledTheme) {
    sunTimesComputed = true;
    const now = new Date();
    const { sunrise, sunset } = getSunTimes(now, latitude, longitude);



    if (now >= sunset || now <= sunrise) {
      applyMapTheme('dark');
    } else {
      applyMapTheme('light');
    }
  }



  if (!userMarker) {
    userMarker = new google.maps.marker.AdvancedMarkerElement({
      position: latLng,
      map: currentMapTheme === 'light' ? mapLight : null,
      title: 'Your Location',
      content: createUserMarkerContent(heading || 0),
      zIndex: 101,
    });



    userMarkerDark = new google.maps.marker.AdvancedMarkerElement({
      position: latLng,
      map: currentMapTheme === 'dark' ? mapDark : null,
      title: 'Your Location',
      content: createUserMarkerContent(heading || 0),
      zIndex: 101,
    });



    map.setCenter(latLng);
    map.setZoom(17);
    setStatus('GPS active');
  } else {
    // Update both markers
    userMarker.map = null;
    userMarker = new google.maps.marker.AdvancedMarkerElement({
      position: latLng,
      map: currentMapTheme === 'light' ? mapLight : null,
      title: 'Your Location',
      content: createUserMarkerContent(heading || 0),
      zIndex: 101,
    });



    userMarkerDark.map = null;
    userMarkerDark = new google.maps.marker.AdvancedMarkerElement({
      position: latLng,
      map: currentMapTheme === 'dark' ? mapDark : null,
      title: 'Your Location',
      content: createUserMarkerContent(heading || 0),
      zIndex: 101,
    });
  }



  let speedKmh = 0;
  if (speed !== null) {
    speedKmh = speed * 3.6;
  } else if (lastPosition && lastPositionTime) {
    const dist = google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(lastPosition.lat, lastPosition.lng),
      new google.maps.LatLng(latLng.lat, latLng.lng)
    );
    const dt = (position.timestamp - lastPositionTime) / 1000;
    if (dt > 0) speedKmh = (dist / dt) * 3.6;
  }
  setCurrentSpeed(speedKmh);



  if (isInActiveSegment && firstCamera && segmentStartTime) {
    if (lastPosition && lastPositionTime) {
      const dist = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(lastPosition.lat, lastPosition.lng),
        new google.maps.LatLng(latLng.lat, latLng.lng)
      );
      segmentTotalDistance += dist;



      const timeDelta = (position.timestamp - lastPositionTime) / 1000;
      segmentTotalTime += timeDelta;



      if (segmentTotalTime > 0) {
        liveAvgSpeed = (segmentTotalDistance / 1000) / (segmentTotalTime / 3600);
        setAvgSpeed(liveAvgSpeed);
      }
    }
  }



  lastPosition = latLng;
  lastPositionTime = position.timestamp;



  if (isInActiveSegment) {
    pathCoordinates.push(new google.maps.LatLng(latLng.lat, latLng.lng));
    if (!pathLine) {
      pathLine = new google.maps.Polyline({
        path: pathCoordinates,
        geodesic: true,
        strokeColor: '#ff0000',
        strokeOpacity: 0.8,
        strokeWeight: 6,
        map: map,
      });
    } else {
      pathLine.setPath(pathCoordinates);
    }
  }



  checkProximityAndCameras(latLng, position.timestamp);



  window.lastHeading = heading || 0;



  if (!manualPan) {
    updateMapMode();
  }
}



function checkProximityAndCameras(latLng, timestamp) {
  let nearestWarningCam = null;
  let nearestDetectionCam = null;
  let inWarning = false;
  let inDetection = false;



  cameras.forEach((cam, i) => {
    if (!warningCircles[i] || !detectionCircles[i]) {
      console.warn('Missing circles for camera index ' + i);
      return;
    }



    const lat = parseFloat(cam.latitude);
    const lng = parseFloat(cam.longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      console.warn('Invalid camera coordinates at index ' + i);
      return;
    }



    const camPos = new google.maps.LatLng(lat, lng);
    const userPos = new google.maps.LatLng(latLng.lat, latLng.lng);
    const distance = google.maps.geometry.spherical.computeDistanceBetween(userPos, camPos);
    const warnRadius = warningCircles[i].radius;
    const detectRadius = detectionCircles[i].radius;



    warningCircles[i].setOptions({ fillOpacity: 0.07, strokeOpacity: 0.6 });
    detectionCircles[i].setOptions({ fillOpacity: 0.15, strokeOpacity: 0.8 });



    if (distance <= detectRadius) {
      inDetection = true;
      nearestDetectionCam = cam;
      detectionCircles[i].setOptions({ fillOpacity: 0.4, strokeOpacity: 1, strokeWeight: 5 });
      handleCameraTrigger(cam, timestamp);
    } else if (distance <= warnRadius) {
      inWarning = true;
      nearestWarningCam = cam;
      warningCircles[i].setOptions({ fillOpacity: 0.15, strokeOpacity: 0.9 });
    }
  });



  if (inDetection && nearestDetectionCam) {
    document.body.style.backgroundColor = '#ffeeee';
    beep(800, 600);
    showToast('ВНИМАНИЕ! КАМЕРА: ' + nearestDetectionCam.name, 'danger');
    lastCameraNameShown = null;
  } else if (inWarning && nearestWarningCam) {
    document.body.style.backgroundColor = '#fff8e7';
    beep(600, 200);
    setCameraText('Приближава: ' + nearestWarningCam.name + ' (' + nearestWarningCam.limit_kmh + ' km/h)');
    if (document.getElementById('warningModal').classList.contains('hidden')) {
      showWarningModal(nearestWarningCam);
    }
  } else {
    document.body.style.backgroundColor = '';
    if (!isInActiveSegment) setCameraText('');
    
    // Reset modal tracking when leaving warning radius
    lastCameraModalShown = null;
    lastCameraNameShown = null; 
  }
}

async function handleCameraTrigger(cam, timestamp) {
  if (lastCameraNameShown === cam.name) {
    // Same camera passed twice - stop tracking
    if (isInActiveSegment) {
      setStatus('Segment cancelled - same camera twice');
      isInActiveSegment = false;
      firstCamera = null;
      pathCoordinates = [];
      if (pathLine) { pathLine.setMap(null); pathLine = null; }
      setAvgSpeed('-');
    }
    return;
  }
  lastCameraNameShown = cam.name;

  const lat = parseFloat(cam.latitude);
  const lng = parseFloat(cam.longitude);

  if (!firstCamera) {
    // First camera - START TRACKING
    firstCamera = { id: cam.id, name: cam.name, latLng: new google.maps.LatLng(lat, lng), time: new Date(timestamp) };
    isInActiveSegment = true;
    segmentStartTime = timestamp;
    segmentTotalDistance = 0;
    segmentTotalTime = 0;
    liveAvgSpeed = 0;
    pathCoordinates = [];
    if (pathLine) { pathLine.setMap(null); pathLine = null; }
    setAvgSpeed(0);
    setStatus('Start: ' + cam.name);
    
    lastBeepTime = Date.now();
    
  } else if (firstCamera.id !== cam.id) {
    // Second camera (different from first) - CHECK IF OFFICIAL SEGMENT EXISTS
    const second = { id: cam.id, name: cam.name, latLng: new google.maps.LatLng(lat, lng), time: new Date(timestamp) };
    const finalAvg = liveAvgSpeed || 0;

    // Check if this segment exists in official_segments
    const segmentExists = await checkOfficialSegment(firstCamera.id, second.id);

    if (segmentExists) {
      // Valid official segment - save it
      lastCompletedSegmentStatus = firstCamera.name + ' → ' + second.name + ': ' + Math.round(finalAvg) + ' km/h';
      setStatus(lastCompletedSegmentStatus);
      setAvgSpeed(finalAvg);
      
      saveSegment(firstCamera, second, finalAvg);
    } else {
      // Not an official segment - show warning but don't save
      setStatus('Invalid segment: ' + firstCamera.name + ' → ' + second.name);
      showToast('This segment is not defined as an official segment', 'warning');
    }

    // STOP TRACKING - don't start new segment yet
    isInActiveSegment = false;
    pathCoordinates = [];
    if (pathLine) { pathLine.setMap(null); pathLine = null; }
    firstCamera = null;
    
    lastBeepTime = Date.now();
  }
}

// Check if an official segment exists between two cameras
async function checkOfficialSegment(firstCameraId, secondCameraId) {
  try {
    const response = await fetch(`/api/check-segment?first=${firstCameraId}&second=${secondCameraId}`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.exists;
  } catch (err) {
    console.error('Error checking segment:', err);
    return false;
  }
}


async function saveSegment(firstCamera, secondCamera, avgSpeedKmh) {
  try {
    await fetch('/api/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        firstCameraId: firstCamera.id,
        secondCameraId: secondCamera.id,
        avgSpeedKmh,
        startedAt: firstCamera.time.toISOString(),
        finishedAt: secondCamera.time.toISOString(),
      }),
    });
  } catch (e) { console.error('Save failed', e); }
}



async function applyMapTheme(theme) {
  currentMapTheme = theme;
  
  if (map) {
    currentMapCenter = map.getCenter();
    currentMapZoom = map.getZoom();
  }
  
  const mapContainer = document.getElementById('map');
  const darkContainer = document.getElementById('map-dark');
  
  if (theme === 'dark') {
    map = mapDark;
    mapContainer.style.display = 'none';
    darkContainer.style.display = 'block';
    // Ensure markers are set correctly
    if (userMarker) {
      userMarker.map = null;
    }
    if (userMarkerDark) {
      userMarkerDark.map = mapDark;
    }
    setTimeout(() => {
      google.maps.event.trigger(mapDark, 'resize');
      mapDark.setCenter(currentMapCenter);
      mapDark.setZoom(currentMapZoom);
      if (userMarkerDark && userMarkerDark.position) {
        mapDark.panTo(userMarkerDark.position);
      }
    }, 100);
  } else {
    map = mapLight;
    mapContainer.style.display = 'block';
    darkContainer.style.display = 'none';
    // Ensure markers are set correctly
    if (userMarker) {
      userMarker.map = mapLight;
    }
    if (userMarkerDark) {
      userMarkerDark.map = null;
    }
    setTimeout(() => {
      google.maps.event.trigger(mapLight, 'resize');
      mapLight.setCenter(currentMapCenter);
      mapLight.setZoom(currentMapZoom);
      if (userMarker && userMarker.position) {
        mapLight.panTo(userMarker.position);
      }
    }, 100);
  }
  
  document.body.classList.add(theme === 'dark' ? 'dark-map' : 'light-map');
  document.body.classList.remove(theme === 'dark' ? 'light-map' : 'dark-map');
  
  const themeLabel = document.getElementById('themeLabel');
  const themeToggle = document.getElementById('themeToggle');
  if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
  if (themeToggle) themeToggle.checked = theme === 'dark';
  
  console.log('Theme switched to: ' + theme);
}



// ============ RADIO CONTROL LOGIC ============
 function updateRadioUI() {
  const radioToggle = document.getElementById('radioToggle');
  const radioBtn = document.getElementById('radioBtn');
  
  if (radioToggle.checked) {
    // Show button and play audio
    radioBtn.classList.remove('hidden');
    radioBtn.classList.add('active');
    if (window.audio) {
      window.audio.play().catch(e => console.error('Radio play error:', e));
    }
  } else {
    // Hide button and stop audio
    radioBtn.classList.add('hidden');
    radioBtn.classList.remove('active');
    if (window.audio) {
      window.audio.pause();
    }
  }
}


function toggleRadioButton() {
  const radioBtn = document.getElementById('radioBtn');
  
  if (window.audio.paused) {
    // Audio is paused, start it and make button green
    window.audio.play().catch(e => console.error('Radio play error:', e));
    radioBtn.classList.add('active');
  } else {
    // Audio is playing, stop it and make button red
    window.audio.pause();
    radioBtn.classList.remove('active');
  }
}

// Function to unlock audio context on first user interaction
function unlockAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      console.log('Audio context unlocked');
      // Try to play radio if toggle is already on
      if (document.getElementById('radioToggle')?.checked && window.audio) {
        window.audio.play().catch(e => console.error('Radio play error:', e));
      }
    });
  }
  
  // Remove listeners after first interaction
  document.removeEventListener('click', unlockAudio);
  document.removeEventListener('touchstart', unlockAudio);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof google !== 'undefined' && google.maps) {
    await initMaps();
  } else {
    setTimeout(() => {
      if (typeof google !== 'undefined' && google.maps) {
        initMaps();
      }
    }, 100);
  }

  // Add interaction listeners to unlock audio
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });

  const burgerBtn = document.getElementById('burgerBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  if (burgerBtn && sidebar && sidebarOverlay) {
    burgerBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      sidebarOverlay.classList.add('show');
      burgerBtn.setAttribute('aria-expanded', 'true');
      sidebar.setAttribute('aria-hidden', 'false');
    });

    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('show');
      burgerBtn.setAttribute('aria-expanded', 'false');
      sidebar.setAttribute('aria-hidden', 'true');
    });

    // Close sidebar when clicking history link
    const historyLink = sidebar.querySelector('a[href="/history"]');
    if (historyLink) {
      historyLink.addEventListener('click', () => {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('show');
        burgerBtn.setAttribute('aria-expanded', 'false');
        sidebar.setAttribute('aria-hidden', 'true');
      });
    }
  }

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('change', () => {
      userManuallyToggledTheme = true;
      applyMapTheme(themeToggle.checked ? 'dark' : 'light');
    });
  }

  // ===== RADIO CONTROL =====
  const radioToggle = document.getElementById('radioToggle');
  const radioBtn = document.getElementById('radioBtn');

  if (radioToggle) {
    radioToggle.addEventListener('change', updateRadioUI);
  }

  if (radioBtn) {
    radioBtn.addEventListener('click', toggleRadioButton);
  }
  // =============================
});


window.addEventListener('beforeunload', () => {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
});



window.initMaps = initMaps;