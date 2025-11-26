let map;
let userMarker = null;
let cameras = [];
let cameraMarkers = [];

let watchId = null;
let lastPosition = null;
let lastPositionTime = null;

// Segment state
let firstCamera = null; // { id, name, latLng, time }
let lastCameraNameShown = null;

// UI elements
let elCurrentSpeed;
let elAvgSpeed;
let elStatus;
let elCameraText;

function setStatus(text) {
  if (elStatus) elStatus.textContent = text;
}

function setCameraText(text) {
  if (elCameraText) elCameraText.textContent = text;
}

function setCurrentSpeed(kmh) {
  if (elCurrentSpeed) elCurrentSpeed.textContent = Math.round(kmh);
}

function setAvgSpeed(kmh) {
  if (elAvgSpeed) elAvgSpeed.textContent = kmh === null ? '-' : Math.round(kmh);
}

// Initialize map and UI
function initMap() {
  elCurrentSpeed = document.getElementById('currentSpeed');
  elAvgSpeed = document.getElementById('avgSpeed');
  elStatus = document.getElementById('statusText');
  elCameraText = document.getElementById('cameraText');

  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 42.6977, lng: 23.3219 }, // Sofia default
    zoom: 12,
    mapTypeId: 'roadmap',
    disableDefaultUI: true,
  });

  setStatus('Requesting GPS...');
  startGeolocation();
  loadCameras();

  window.addEventListener('beforeunload', () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
  });
}

// Load cameras from backend and put markers on the map
async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    if (!res.ok) throw new Error('Failed to load cameras');
    cameras = await res.json();

    const bounds = new google.maps.LatLngBounds();
    cameras.forEach((cam) => {
      const pos = new google.maps.LatLng(cam.latitude, cam.longitude);
      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: cam.name,
        // TODO: custom icon for speed camera
      });
      cameraMarkers.push(marker);
      bounds.extend(pos);
    });

    if (cameras.length > 0) {
      map.fitBounds(bounds);
    }
  } catch (err) {
    console.error('Error loading cameras:', err);
    setCameraText('Failed to load cameras');
  }
}

// Start geolocation permission request and then watch position
function startGeolocation() {
  if (!navigator.geolocation) {
    setStatus('Geolocation not supported');
    return;
  }

  setStatus('Requesting GPS permission...');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setStatus('GPS permission granted');
      startWatchPosition();
    },
    (error) => {
      setStatus('GPS permission denied or error: ' + error.message);
      console.error('Geolocation permission error:', error);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function startWatchPosition() {
  const options = {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  };

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    (error) => {
      console.error('Geolocation error:', error);
      setStatus('GPS error: ' + error.message);
    },
    options
  );
}

// Called on each GPS update
function onPosition(position) {
  const { latitude, longitude, speed } = position.coords;
  const timestamp = position.timestamp;

  const latLng = new google.maps.LatLng(latitude, longitude);

  if (!userMarker) {
    userMarker = new google.maps.Marker({
      position: latLng,
      map,
      title: 'You',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#00ff00',
        fillOpacity: 1,
        strokeColor: '#003300',
        strokeWeight: 2,
      },
    });
    map.setCenter(latLng);
    map.setZoom(15);
    setStatus('GPS active');
  } else {
    userMarker.setPosition(latLng);
  }

  // Speed in km/h
  let speedKmh = 0;

  if (typeof speed === 'number' && !Number.isNaN(speed)) {
    speedKmh = speed * 3.6;
  } else if (lastPosition && lastPositionTime) {
    const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(
      lastPosition,
      latLng
    );
    const dtSeconds = (timestamp - lastPositionTime) / 1000;
    if (dtSeconds > 0) {
      const speedMs = distanceMeters / dtSeconds;
      speedKmh = speedMs * 3.6;
    }
  }

  setCurrentSpeed(speedKmh);

  lastPosition = latLng;
  lastPositionTime = timestamp;

  checkCameras(latLng, timestamp);
}

// Detect if near any camera and handle segment logic
function checkCameras(latLng, timestamp) {
  if (!cameras || cameras.length === 0) return;

  const THRESHOLD = 80;

  let nearest = null;
  let nearestDistance = Infinity;

  cameras.forEach((cam) => {
    const camLatLng = new google.maps.LatLng(cam.latitude, cam.longitude);
    const d = google.maps.geometry.spherical.computeDistanceBetween(
      latLng,
      camLatLng
    );
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = { cam, camLatLng };
    }
  });

  if (!nearest || nearestDistance > THRESHOLD) {
    return;
  }

  const cam = nearest.cam;
  const camName = cam.name;

  if (lastCameraNameShown === camName) {
    return;
  }
  lastCameraNameShown = camName;
  setCameraText(`Camera: ${camName}`);

  if (!firstCamera) {
    firstCamera = {
      id: cam.id,
      name: cam.name,
      latLng: nearest.camLatLng,
      time: new Date(timestamp),
    };
    setStatus('Segment started at ' + camName);
    setAvgSpeed(null);
  } else if (firstCamera.id !== cam.id) {
    const secondCamera = {
      id: cam.id,
      name: cam.name,
      latLng: nearest.camLatLng,
      time: new Date(timestamp),
    };

    const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(
      firstCamera.latLng,
      secondCamera.latLng
    );
    const dtSeconds = (secondCamera.time - firstCamera.time) / 1000;

    if (dtSeconds > 0) {
      const avgSpeedKmh = (distanceMeters / 1000) / (dtSeconds / 3600);
      setAvgSpeed(avgSpeedKmh);
      setStatus(`Between ${firstCamera.name} and ${secondCamera.name}`);

      saveSegment(firstCamera, secondCamera, avgSpeedKmh).catch((err) =>
        console.error('Error saving segment:', err)
      );
    } else {
      setStatus('Invalid time difference between cameras');
    }

    firstCamera = {
      id: secondCamera.id,
      name: secondCamera.name,
      latLng: secondCamera.latLng,
      time: secondCamera.time,
    };
  }
}

// Save average speed segment to server
async function saveSegment(firstCamera, secondCamera, avgSpeedKmh) {
  const body = {
    firstCameraId: firstCamera.id,
    secondCameraId: secondCamera.id,
    avgSpeedKmh,
    startedAt: firstCamera.time.toISOString(),
    finishedAt: secondCamera.time.toISOString(),
  };

  const res = await fetch('/api/segments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error('Failed to save segment');
  }
}

// Expose initMap globally for Google callback
window.initMap = initMap;
