let cameras = [];
let segments = [];
let editingCameraId = null;
let editingSegmentId = null;

// ========== MODAL MANAGEMENT ==========
function openCameraModal(cameraId = null) {
  editingCameraId = cameraId;
  const modal = document.getElementById('cameraModal');
  const form = document.getElementById('cameraForm');
  const title = document.getElementById('cameraModalTitle');

  form.reset();

  if (cameraId) {
    const camera = cameras.find(c => c.id === cameraId);
    if (camera) {
      title.textContent = 'Edit Camera';
      document.getElementById('cameraName').value = camera.name;
      document.getElementById('cameraLatitude').value = camera.latitude;
      document.getElementById('cameraLongitude').value = camera.longitude;
      document.getElementById('cameraLimitKmh').value = camera.limit_kmh;
      document.getElementById('cameraDetectionRadius').value = camera.detection_radius_m;
      document.getElementById('cameraWarningRadius').value = camera.warning_radius_m;
      document.getElementById('cameraIsActive').checked = camera.is_active;
    }
  } else {
    title.textContent = 'Add Camera';
  }

  modal.classList.remove('hidden');
}

function closeCameraModal() {
  document.getElementById('cameraModal').classList.add('hidden');
  editingCameraId = null;
}

function openSegmentModal(segmentId = null) {
  editingSegmentId = segmentId;
  const modal = document.getElementById('segmentModal');
  const form = document.getElementById('segmentForm');
  const title = document.getElementById('segmentModalTitle');

  form.reset();
  populateCameraSelects();

  if (segmentId) {
    const segment = segments.find(s => s.id === segmentId);
    if (segment) {
      title.textContent = 'Edit Segment';
      document.getElementById('segmentFirstCamera').value = segment.first_camera_id;
      document.getElementById('segmentSecondCamera').value = segment.second_camera_id;
      document.getElementById('segmentSpeedLimit').value = segment.speed_limit;
    }
  } else {
    title.textContent = 'Add Segment';
  }

  modal.classList.remove('hidden');
}

function closeSegmentModal() {
  document.getElementById('segmentModal').classList.add('hidden');
  editingSegmentId = null;
}

function populateCameraSelects() {
  const firstSelect = document.getElementById('segmentFirstCamera');
  const secondSelect = document.getElementById('segmentSecondCamera');
  
  const currentFirst = firstSelect.value;
  const currentSecond = secondSelect.value;
  
  firstSelect.innerHTML = '<option value="">-- Select Camera --</option>';
  secondSelect.innerHTML = '<option value="">-- Select Camera --</option>';
  
  cameras.forEach(camera => {
    const option1 = document.createElement('option');
    option1.value = camera.id;
    option1.textContent = camera.name;
    firstSelect.appendChild(option1);
    
    const option2 = document.createElement('option');
    option2.value = camera.id;
    option2.textContent = camera.name;
    secondSelect.appendChild(option2);
  });
  
  if (currentFirst) firstSelect.value = currentFirst;
  if (currentSecond) secondSelect.value = currentSecond;
}

// ========== FETCH DATA ==========
async function loadCameras() {
  try {
    const response = await fetch('/api/admin/cameras');
    if (!response.ok) throw new Error('Failed to fetch cameras');
    cameras = await response.json();
    renderCamerasTable();
    populateCameraSelects();
  } catch (err) {
    console.error('Error loading cameras:', err);
    showToast('Failed to load cameras', 'error');
  }
}

async function loadSegments() {
  try {
    const response = await fetch('/api/admin/segments');
    if (!response.ok) throw new Error('Failed to fetch segments');
    segments = await response.json();
    renderSegmentsTable();
  } catch (err) {
    console.error('Error loading segments:', err);
    showToast('Failed to load segments', 'error');
  }
}

// ========== RENDER TABLES ==========
function renderCamerasTable() {
  const tbody = document.getElementById('camerasTableBody');
  tbody.innerHTML = '';

  if (cameras.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No cameras added yet</td></tr>';
    return;
  }

  cameras.forEach(camera => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${camera.name}</td>
      <td>${parseFloat(camera.latitude).toFixed(6)}</td>
      <td>${parseFloat(camera.longitude).toFixed(6)}</td>
      <td>${camera.limit_kmh}</td>
      <td>${camera.is_active ? '✓' : '-'}</td>
      <td class="action-buttons">
        <button class="btn-edit" onclick="openCameraModal('${camera.id}')">Edit</button>
        <button class="btn-delete" onclick="deleteCamera('${camera.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function renderSegmentsTable() {
  const tbody = document.getElementById('segmentsTableBody');
  tbody.innerHTML = '';

  if (segments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No segments added yet</td></tr>';
    return;
  }

  segments.forEach(segment => {
    const createdDate = new Date(segment.created_at).toLocaleString();
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${segment.first_camera_name}</td>
      <td>${segment.second_camera_name}</td>
      <td>${segment.speed_limit}</td>
      <td>${createdDate}</td>
      <td class="action-buttons">
        <button class="btn-edit" onclick="openSegmentModal('${segment.id}')">Edit</button>
        <button class="btn-delete" onclick="deleteSegment('${segment.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ========== CRUD OPERATIONS ==========
async function saveCamera(e) {
  e.preventDefault();

  const cameraData = {
    name: document.getElementById('cameraName').value,
    latitude: parseFloat(document.getElementById('cameraLatitude').value),
    longitude: parseFloat(document.getElementById('cameraLongitude').value),
    limit_kmh: parseInt(document.getElementById('cameraLimitKmh').value),
    detection_radius_m: parseInt(document.getElementById('cameraDetectionRadius').value),
    warning_radius_m: parseInt(document.getElementById('cameraWarningRadius').value),
    is_active: document.getElementById('cameraIsActive').checked,
  };

  try {
    const url = editingCameraId 
      ? `/api/admin/cameras/${editingCameraId}`
      : '/api/admin/cameras';
    const method = editingCameraId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cameraData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save camera');
    }

    showToast(editingCameraId ? 'Camera updated' : 'Camera added', 'success');
    closeCameraModal();
    loadCameras();
  } catch (err) {
    console.error('Error saving camera:', err);
    showToast(err.message || 'Failed to save camera', 'error');
  }
}

async function deleteCamera(cameraId) {
  if (!confirm('Are you sure you want to delete this camera?')) return;

  try {
    const response = await fetch(`/api/admin/cameras/${cameraId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete camera');

    showToast('Camera deleted', 'success');
    loadCameras();
  } catch (err) {
    console.error('Error deleting camera:', err);
    showToast('Failed to delete camera', 'error');
  }
}

async function saveSegment(e) {
  e.preventDefault();

  const segmentData = {
    first_camera_id: document.getElementById('segmentFirstCamera').value,
    second_camera_id: document.getElementById('segmentSecondCamera').value,
    speed_limit: parseInt(document.getElementById('segmentSpeedLimit').value),
  };

  try {
    const url = editingSegmentId 
      ? `/api/admin/segments/${editingSegmentId}`
      : '/api/admin/segments';
    const method = editingSegmentId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(segmentData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save segment');
    }

    showToast(editingSegmentId ? 'Segment updated' : 'Segment added', 'success');
    closeSegmentModal();
    loadSegments();
  } catch (err) {
    console.error('Error saving segment:', err);
    showToast(err.message || 'Failed to save segment', 'error');
  }
}

async function deleteSegment(segmentId) {
  if (!confirm('Are you sure you want to delete this segment?')) return;

  try {
    const response = await fetch(`/api/admin/segments/${segmentId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete segment');

    showToast('Segment deleted', 'success');
    loadSegments();
  } catch (err) {
    console.error('Error deleting segment:', err);
    showToast('Failed to delete segment', 'error');
  }
}

// ========== TOAST NOTIFICATION ==========
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  const bgColor = type === 'error' ? '#d32f2f' : type === 'success' ? '#4caf50' : '#0d6efd';
  toast.style.cssText = `position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: ${bgColor}; color: white; padding: 12px 24px; border-radius: 8px; z-index: 9999; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== EVENT LISTENERS ==========
document.addEventListener('DOMContentLoaded', () => {
  loadCameras();
  loadSegments();

  // Camera modal
  document.getElementById('addCameraBtn').addEventListener('click', () => openCameraModal());
  document.getElementById('closeCameraModal').addEventListener('click', closeCameraModal);
  document.getElementById('cancelCameraBtn').addEventListener('click', closeCameraModal);
  document.getElementById('cameraModalOverlay').addEventListener('click', closeCameraModal);
  document.getElementById('cameraForm').addEventListener('submit', saveCamera);

  // Segment modal
  document.getElementById('addSegmentBtn').addEventListener('click', () => openSegmentModal());
  document.getElementById('closeSegmentModal').addEventListener('click', closeSegmentModal);
  document.getElementById('cancelSegmentBtn').addEventListener('click', closeSegmentModal);
  document.getElementById('segmentModalOverlay').addEventListener('click', closeSegmentModal);
  document.getElementById('segmentForm').addEventListener('submit', saveSegment);
});

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCameraModal();
    closeSegmentModal();
  }
});
