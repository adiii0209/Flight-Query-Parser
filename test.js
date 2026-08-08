

function triggerDownloadFromResponse(r) {
  let filename = 'Hotel_Voucher.pdf';
  const disposition = r.headers.get('Content-Disposition');
  if (disposition && disposition.indexOf('filename=') !== -1) {
    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
    if (matches != null && matches[1]) {
      filename = matches[1].replace(/['"]/g, '');
    }
  }
  return r.blob().then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

window.HOTEL_BOOKING_ID = null;
const HOTEL_SVG = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:#cbd5e1"><path d="M3 20v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"/><path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M11 4v6"/><path d="M8 11v4"/><path d="M16 11v4"/><path d="M4 15h16"/></svg>';
const RESORT_FALLBACK_IMAGE = '/resort.png';
const CURRENCY_OPTIONS = ['INR', 'USD', 'AED'];
let bookings = [];
let currentBooking = null;
let uploadedImageUrl = null;
let currentBookingSnapshot = null;

document.addEventListener('DOMContentLoaded', () => {
  setupSidebar();
  setupImportModal();
  setupClipboardPaste();
  startIstClock();
  if (window.HOTEL_BOOKING_ID) {
    loadDetail(window.HOTEL_BOOKING_ID);
  } else {
    loadBookings();
  }
});

function setupSidebar() {
  const toggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => { sidebar.classList.add('active'); overlay?.classList.add('active'); });
    overlay?.addEventListener('click', () => { sidebar.classList.remove('active'); overlay.classList.remove('active'); });
  }
}

function setupImportModal() {
  const zone = document.getElementById('modalDropZone');
  if (!zone) return;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const input = document.getElementById('modalFileInput');
      if (input) input.files = e.dataTransfer.files;
      handleModalFileSelected({ files: e.dataTransfer.files });
    }
  });
}

function openImportModal() {
  document.getElementById('importModalOverlay').classList.add('open');
  document.getElementById('importTabsContainer').style.display = 'flex';
  switchImportTab('pdf');
  document.getElementById('modalDropZone').style.display = 'flex';
  document.getElementById('importProcessing').classList.remove('active');
  const fileInput = document.getElementById('modalFileInput');
  if (fileInput) fileInput.value = '';
}

function closeImportModal() {
  document.getElementById('importModalOverlay').classList.remove('open');
}

function switchImportTab(tab) {
  const pdfBtn = document.getElementById('pdfTabBtn');
  const textBtn = document.getElementById('textTabBtn');
  const pdfPanel = document.getElementById('pdfImportPanel');
  const textPanel = document.getElementById('textImportPanel');
  const isPdf = tab === 'pdf';
  pdfBtn?.classList.toggle('active', isPdf);
  textBtn?.classList.toggle('active', !isPdf);
  pdfPanel?.classList.toggle('active', isPdf);
  textPanel?.classList.toggle('active', !isPdf);
  
  if (pdfPanel) pdfPanel.style.display = '';
  if (textPanel) textPanel.style.display = '';
  
  if (!isPdf) {
    const rawText = document.getElementById('rawText');
    setTimeout(() => rawText?.focus(), 0);
  }
}

function handleModalFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  document.getElementById('importTabsContainer').style.display = 'none';
  document.getElementById('modalDropZone').style.display = 'none';
  document.getElementById('importProcessing').classList.add('active');
  parseFile(file);
}

function setupClipboardPaste() {
  document.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items || [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (currentBooking && blob) {
          const fd = new FormData();
          fd.append('image', blob, 'pasted_image.png');
          await uploadImageFormData(fd);
        } else {
          showToast('Open a hotel booking to paste an image.', 'error');
        }
        e.preventDefault();
        return;
      }
    }
  });
}

function startIstClock() {
  const clock = document.getElementById('istClock');
  if (!clock) return;
  const tick = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    clock.textContent = `${map.hour || '00'}:${map.minute || '00'}:${map.second || '00'}`;
  };
  tick();
  setInterval(tick, 1000);
}

async function parseFile(file) {
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/hotels/parse', { method: 'POST', body: fd });
    const json = await r.json();
    if (!r.ok || !json.success) {
      showToast(json.error || 'Parse failed', 'error');
      closeImportModal();
      return;
    }
    await saveParsedBooking(json.data);
  } catch (err) {
    showToast('Network error', 'error');
    closeImportModal();
  }
}

async function parseBookingText() {
  const rawText = document.getElementById('rawText').value.trim();
  if (!rawText) {
    showToast('Please paste booking text first.', 'warning');
    return;
  }
  
  document.getElementById('importTabsContainer').style.display = 'none';
  document.getElementById('textImportPanel').style.display = 'none';
  document.getElementById('importProcessing').classList.add('active');
  
  try {
    const fd = new FormData();
    fd.append('text', rawText);
    const r = await fetch('/api/hotels/parse', { method: 'POST', body: fd });
    const json = await r.json();
    if (!r.ok || !json.success) {
      showToast(json.error || 'Parse failed', 'error');
      closeImportModal();
      return;
    }
    await saveParsedBooking(json.data);
  } catch (err) {
    showToast('Network error', 'error');
    closeImportModal();
  }
}

async function saveParsedBooking(payload) {
  const saveR = await fetch('/api/hotels', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const saved = await saveR.json();
  if (!saveR.ok) {
    showToast(saved.error || 'Save failed', 'error');
    closeImportModal();
    return;
  }
  showToast('Booking parsed and saved');
  closeImportModal();
  await loadBookings();
  openDetailRoute(saved.id);
}

function clearParser() {
  const rawText = document.getElementById('rawText');
  if (rawText) rawText.value = '';
}

async function loadBookings() {
  try {
    const r = await fetch('/api/hotels');
    bookings = await r.json();
    renderGrid();
  } catch (err) {
    console.error(err);
  }
}

function renderGrid() {
  const grid = document.getElementById('hotelGrid');
  const empty = document.getElementById('emptyState');
  const inDetail = Boolean(window.HOTEL_BOOKING_ID);
  if (!grid || !empty) return;
  if (!bookings.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = inDetail ? 'none' : 'none';
  grid.innerHTML = bookings.map(renderCard).join('');
}

function renderCard(b) {
  return `
    <div class="hotel-card" onclick="openDetailRoute('${b.id}')">
      <div class="hotel-card-img">
        ${b.image_url ? `<img src="${b.image_url}" alt="${esc(b.hotel_name || 'Hotel')}" onerror="this.parentElement.innerHTML=HOTEL_SVG">` : HOTEL_SVG}
      </div>
      <div class="hotel-card-body">
        <div class="hotel-card-name">${esc(b.hotel_name || 'Unknown Hotel')}</div>
        <div class="hotel-card-meta">${formatCardMeta(b)}</div>
        <div class="hotel-card-dates">
          ${b.check_in_date ? `<span class="date-chip">IN ${esc(b.check_in_date)}</span>` : ''}
          ${b.check_out_date ? `<span class="date-chip">OUT ${esc(b.check_out_date)}</span>` : ''}
        </div>
        <div class="hotel-card-footer">
          <span class="hotel-amount">${formatHotelAmount(b)}</span>
          <div class="hotel-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-pdf btn-sm" onclick="downloadPDF('${b.id}', this)">PDF</button>
            <button class="btn btn-danger btn-sm" onclick="deleteBooking('${b.id}')">&times;</button>
          </div>
        </div>
      </div>
    </div>`;
}

function openDetailRoute(id, skipPushState = false) {
  if (!skipPushState) {
    history.pushState({ id }, '', `/hotels/${id}`);
  }
  const b = bookings.find(x => x.id == id);
  if (b) {
    currentBooking = b;
    uploadedImageUrl = null;
    renderDetail(b);
  } else {
    loadDetail(id);
  }
  document.body.classList.add('detail-mode');
  const empty = document.getElementById('emptyState');
  if (empty) empty.style.display = 'none';
}

window.addEventListener('popstate', (e) => {
  const path = window.location.pathname;
  if (path.startsWith('/hotels/')) {
    const id = path.split('/')[2];
    openDetailRoute(id, true);
  } else {
    closeDetail(true);
  }
});

async function loadDetail(id) {
  try {
    const r = await fetch(`/api/hotels/${id}`);
    if (!r.ok) {
      showToast('Hotel booking not found', 'error');
      closeDetail();
      return;
    }
    const booking = await r.json();
    currentBooking = booking;
    uploadedImageUrl = null;
    renderDetail(booking);
  } catch (err) {
    showToast('Unable to load booking', 'error');
    closeDetail();
  }
}

function togglePaidLogo() {
  if (!currentBooking) return;
  const paidToggle = document.getElementById('paidLogoToggle');
  if (paidToggle) {
    currentBooking.show_paid_logo = !currentBooking.show_paid_logo;
    paidToggle.classList.toggle('active', currentBooking.show_paid_logo);
    paidToggle.textContent = currentBooking.show_paid_logo ? 'Paid in Full: On' : 'Paid in Full: Off';
  }
}

function renderDetail(b) {
  document.getElementById('detailTitle').textContent = b.hotel_name || 'Hotel Booking';
  document.getElementById('detailSubtitle').textContent = [b.booking_id, b.guest_name, b.check_in_date ? `Check-in ${b.check_in_date}` : ''].filter(Boolean).join(' · ');
  document.getElementById('detailBody').innerHTML = buildDetailHTML(b);
  const paidToggle = document.getElementById('paidLogoToggle');
  if (paidToggle) {
    const active = Boolean(b.show_paid_logo);
    paidToggle.classList.toggle('active', active);
    paidToggle.textContent = active ? 'Paid in Full: On' : 'Paid in Full: Off';
  }
  
  document.getElementById('hotelDetailPage').style.display = '';
  
  if (window.quill) {
      delete window.quill;
  }
  window.quill = new Quill('#f_special_instructions_editor', {
    theme: 'snow',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline'],
        [{ 'list': 'bullet' }],
        ['clean']
      ]
    }
  });
  // Need to set raw HTML since it comes from DB
  window.quill.root.innerHTML = b.special_instructions || '';
  window.quill.on('text-change', function() {
      if (typeof handleDetailChange === 'function') handleDetailChange();
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeDetail(skipPushState = false) {
  if (!skipPushState) {
    history.pushState(null, '', '/hotels');
  }
  document.body.classList.remove('detail-mode');
  
  document.getElementById('hotelDetailPage').style.display = '';
  
  if (window.quill) {
      delete window.quill;
  }
  window.quill = new Quill('#f_special_instructions_editor', {
    theme: 'snow',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline'],
        [{ 'list': 'bullet' }],
        ['clean']
      ]
    }
  });
  // Need to set raw HTML since it comes from DB
  window.quill.root.innerHTML = b.special_instructions || '';
  window.quill.on('text-change', function() {
      if (typeof handleDetailChange === 'function') handleDetailChange();
  });

  currentBooking = null;
  renderGrid();
}

function buildDetailHTML(b) {
  const rooms = getRoomsForDisplay(b);
  const amenities = Array.isArray(b.amenities) ? b.amenities : [];
  return `
    <div class="detail-grid">
      <div class="detail-panel">
        <div class="detail-img-wrap" id="detailImgWrap" title="Paste an image into this booking">
          <div class="img-paste-hint">Ctrl+V / Cmd+V to paste image</div>
          ${b.image_url ? `<img id="detailImg" src="${b.image_url}" alt="Hotel" onerror="this.outerHTML='<span id=\\'detailImg\\'>'+HOTEL_SVG+'</span>'">` : `<span id="detailImg">${HOTEL_SVG}</span>`}
          <button class="img-overlay-btn" type="button" onclick="triggerImageUpload()">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            Upload Custom Image
          </button>
        </div>
        <input type="file" id="imgUploadInput" accept="image/*" style="display:none" onchange="uploadCustomImage(this)">
        <div class="section-title">Hotel Details</div>
        <div class="form-row">
          <div class="input-group"><label>Hotel Name</label><input id="f_hotel_name" value="${esc(b.hotel_name || '')}"></div>
          <div class="input-group"><label>Phone</label><input id="f_hotel_phone" value="${esc(b.hotel_phone || '')}"></div>
        </div>
        <div class="input-group"><label>Address</label><input id="f_hotel_address" value="${esc(b.hotel_address || '')}"></div>
        <div class="form-row">
          <div class="input-group"><label>Booking Reference</label><input id="f_booking_id" value="${esc(b.booking_id || b.booking_confirmation || '')}"></div>
          <div class="input-group"><label>Primary Guest</label><input id="f_guest_name" value="${esc(b.guest_name || '')}" oninput="updatePrimaryGuest(this.value)"></div>
        </div>
        <div class="form-row">
          <div class="input-group"><label>Check-in Date</label><input id="f_check_in_date" type="date" value="${b.check_in_date || ''}"></div>
          <div class="input-group"><label>Check-out Date</label><input id="f_check_out_date" type="date" value="${b.check_out_date || ''}"></div>
        </div>
        <div class="form-row">
          <div class="input-group"><label>Check-in Time</label><input id="f_check_in_time" value="${esc(b.check_in_time || '')}" placeholder="2:00 PM"></div>
          <div class="input-group"><label>Check-out Time</label><input id="f_check_out_time" value="${esc(b.check_out_time || '')}" placeholder="11:00 AM"></div>
        </div>
        <div class="form-row">
          <div class="input-group"><label>Total Guests</label><input id="f_num_guests" type="number" min="1" value="${b.num_guests || 1}"></div>
          <div class="input-group"><label>Room Count</label><input id="f_room_count" type="number" min="1" value="${b.room_count || Math.max(1, rooms.length || 1)}"></div>
        </div>
        <div class="form-row">
          <div class="input-group"><label>Room Type</label><input id="f_room_type" value="${esc(b.room_type || '')}" oninput="updatePrimaryRoomType(this.value)"></div>
          <div class="input-group"><label>Meal Plan</label><input id="f_meal_plan" value="${esc(b.meal_plan || '')}"></div>
        </div>
        <div class="currency-amount-row">
          <div class="input-group"><label>Currency</label><input id="f_currency" value="${esc(b.currency || '')}" placeholder="INR / USD / AED"></div>
          <div class="input-group"><label>Total Amount</label><input id="f_total_amount" type="text" inputmode="decimal" value="${b.total_amount ?? ''}"></div>
        </div>
        <div class="input-group"><label>Special Instructions</label><textarea id="f_special_instructions">${esc(b.special_instructions || '')}</textarea></div>
      </div>
      <div class="detail-panel">
        <h3>Rooms and Guests</h3>
        ${renderRoomsEditor(rooms)}
        <div class="section-title">Amenities</div>
        ${renderAmenitiesEditor(amenities)}
      </div>
    </div>
    <div class="detail-actions" style="align-items:center;">
      <button class="btn btn-primary" id="saveChangesBtn" type="button" onclick="saveDetail()">Save Changes</button>
      <div style="display:flex; align-items:center; gap:0.5rem; margin-right:auto; margin-left:0.5rem;">
        <span style="font-size:0.9rem; color:#475569; font-weight:600;">Paid in Full</span>
        <label class="switch">
          <input type="checkbox" id="paidLogoToggle" onchange="togglePaidLogo()">
          <span class="slider round"></span>
        </label>
      </div>
      <button class="btn btn-secondary" type="button" onclick="openSpecialRequestModal()">Special Requests</button>
      <button class="btn btn-pdf" id="downloadPdfBtn" type="button" onclick="downloadPDF('${b.id}', this)">Download PDF</button>
      <button class="btn btn-danger" type="button" onclick="deleteBooking('${b.id}')">Delete</button>
    </div>`;
}

function getRoomsForDisplay(b) {
  let displayRooms = [];
  const rooms = Array.isArray(b?.rooms) ? b.rooms.filter(Boolean) : [];
  if (rooms.length) {
    let seenGuestStrings = new Set();
    displayRooms = rooms.map((room, index) => {
      let guests = Array.isArray(room.guests) ? room.guests : [];
      let guestStr = guests.join('|').toLowerCase();
      let finalCount = Number.isFinite(Number(room.guest_count)) ? Number(room.guest_count) : ((room.guests || []).length || 1);
      
      if (guestStr && seenGuestStrings.has(guestStr) && index > 0) {
         guests = [];
         finalCount = 0;
      }
      if (guestStr) seenGuestStrings.add(guestStr);
      
      return {
        room_type: room.room_type || b?.room_type || rooms[0]?.room_type || '',
        guest_count: finalCount,
        guests: guests,
        guest_summary: room.guest_summary || '',
      };
    });
  } else if (b?.room_type || b?.guest_name || b?.num_guests) {
    displayRooms = [{
      room_type: b.room_type || '',
      guest_count: b.num_guests || 1,
      guests: b.guest_name ? [b.guest_name] : [],
      guest_summary: !b.guest_name && b.num_guests ? `${b.num_guests} guest(s)` : ''
    }];
  }

  const targetRoomCount = Number.isFinite(Number(b?.room_count)) ? Number(b.room_count) : 0;
  while (displayRooms.length < targetRoomCount) {
    displayRooms.push({
      room_type: b?.room_type || displayRooms[0]?.room_type || '',
      guest_count: 0,
      guests: [],
      guest_summary: ''
    });
  }

  return displayRooms.map(normalizeRoom);
}

function formatCardMeta(b) {
  const rooms = getRoomsForDisplay(b);
  const roomCount = rooms.length || b?.room_count || 0;
  const guestCount = b?.num_guests || rooms.reduce((sum, room) => sum + ((room.guests || []).length || 0), 0);
  const leadGuest = b?.guest_name || rooms.flatMap(room => room.guests || [])[0] || '';
  const parts = [];
  if (leadGuest) parts.push(esc(leadGuest));
  if (roomCount) parts.push(`${roomCount} room${roomCount > 1 ? 's' : ''}`);
  if (guestCount) parts.push(`${guestCount} guest${guestCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function formatHotelAmount(b) {
  if (b?.total_amount == null || b.total_amount === '') return '-';
  const prefix = b?.currency ? `${esc(b.currency)} ` : '';
  const value = Number(b.total_amount);
  return Number.isFinite(value) ? `${prefix}${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : `${prefix}${esc(String(b.total_amount))}`;
}

function parseAmountInput(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function renderRoomsEditor(roomsInput) {
  const items = Array.isArray(roomsInput) ? roomsInput : [];
  return `
    <div id="roomList" class="room-list">${renderRoomCards(items)}</div>
    <button type="button" class="btn btn-secondary btn-sm" onclick="addRoom()">Add Room</button>`;
}

function renderRoomCards(items) {
  if (!items.length) {
    return '<span style="color:#94a3b8;font-size:.85rem">No rooms extracted yet</span>';
  }
  return items.map((room, index) => `
    <div class="room-card">
      <div class="room-card-header">
        <div class="room-card-title">Room ${index + 1}</div>
        <div class="room-card-actions">
          <button type="button" class="chip-icon-btn" title="Delete room" onclick="removeRoom(${index})">&times;</button>
        </div>
      </div>
      <div class="input-group">
        <label>Room Type</label>
        <input type="text" value="${esc(room.room_type || '')}" onchange="updateRoomField(${index}, 'room_type', this.value)">
      </div>
      <div class="input-group">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
          <label style="margin:0;">Guest Names</label>
          <button type="button" title="Add Guest" onclick="addRoomGuest(${index}, ${Math.max(0, parseInt(room.guest_count, 10) || 0) - 1})" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; border-radius:4px; padding:0.15rem 0.5rem; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:0.25rem; font-weight:500;">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            Add Guest
          </button>
        </div>
        ${renderGuestFields(room, index)}
      </div>
    </div>`).join('');
}

function renderGuestFields(room, roomIndex) {
  const guestCount = Math.max(0, parseInt(room.guest_count, 10) || 0);
  const guests = Array.isArray(room.guests) ? room.guests : [];
  const rows = [];
  if (guestCount === 0) {
    rows.push(`
      <div class="guest-field-row empty-drop-zone" style="background:#f8fafc; color:#94a3b8; font-style:italic; padding:0.5rem; text-align:center; border: 1px dashed #cbd5e1; border-radius:4px; justify-content:center; cursor:default; display:flex; align-items:center; gap:0.5rem;" ondragenter="handleGuestDragEnter(event)" ondragover="handleGuestDragOver(event)" ondragleave="handleGuestDragLeave(event)" ondrop="handleGuestDrop(event, ${roomIndex}, 0)">
        Empty Room - Drop guests here
      </div>`);
  } else {
    for (let i = 0; i < guestCount; i += 1) {
      rows.push(`
        <div class="guest-field-row" draggable="true" ondragstart="handleGuestDragStart(event, ${roomIndex}, ${i})" ondragend="handleGuestDragEnd(event)" ondragenter="handleGuestDragEnter(event)" ondragover="handleGuestDragOver(event)" ondragleave="handleGuestDragLeave(event)" ondrop="handleGuestDrop(event, ${roomIndex}, ${i})">
          <span><span class="drag-handle" title="Drag to reorder/segment">&#10303;</span>${i === 0 ? 'Primary Guest' : `Guest ${i + 1}`}</span>
          <div style="display:flex; flex:1; align-items:center; gap:0.25rem;">
            <input type="text" value="${esc(guests[i] || '')}" placeholder="${i === 0 ? 'Primary guest name' : `Guest ${i + 1} name`}" onchange="updateRoomGuestName(${roomIndex}, ${i}, this.value)" style="flex:1;">
            <button type="button" title="Remove Guest" onclick="removeRoomGuest(${roomIndex}, ${i})" style="background:none; border:none; color:#ef4444; cursor:pointer; display:flex; padding:0.25rem;">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path></svg>
            </button>
          </div>
        </div>`);
    }
  }
  return `<div class="guest-fields">${rows.join('')}</div>`;
}

function normalizeRoom(room = {}) {
  let guests = Array.isArray(room.guests) ? room.guests.map(g => String(g || '').trim()) : [];
  
  if (guests.length === 1 && guests[0].match(/,|\s+&\s+|\s+and\s+/i)) {
    guests = guests[0].split(/,|\s+&\s+|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  }

  let parsedCount = parseInt(room.guest_count, 10);
  if (isNaN(parsedCount)) {
    parsedCount = guests.filter(Boolean).length;
  }
  const guestCount = Math.max(0, parsedCount);
  while (guests.length < guestCount) guests.push('');
  return {
    room_type: String(room.room_type || '').trim(),
    guest_count: guestCount,
    guests: guests.slice(0, guestCount),
    guest_summary: String(room.guest_summary || '').trim(),
  };
}

function getRooms() {
  return getRoomsForDisplay(currentBooking).map(normalizeRoom);
}

function setRooms(nextRooms) {
  if (!currentBooking) return;
  currentBooking.rooms = nextRooms.map(normalizeRoom);
  document.getElementById('roomList').innerHTML = renderRoomCards(currentBooking.rooms);
}

function addRoom() {
  const rooms = getRooms();
  const roomType = currentBooking?.room_type || rooms[0]?.room_type || '';
  setRooms([...rooms, { room_type: roomType, guest_count: 0, guests: [], guest_summary: '' }]);
}

function removeRoom(index) {
  const rooms = getRooms();
  rooms.splice(index, 1);
  setRooms(rooms);
}

let draggedGuest = null;

function handleGuestDragStart(event, roomIndex, guestIndex) {
  draggedGuest = { roomIndex, guestIndex };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `${roomIndex},${guestIndex}`);
  event.target.style.opacity = '0.5';
}

function handleGuestDragEnd(event) {
  event.target.style.opacity = '1';
  draggedGuest = null;
  document.querySelectorAll('.guest-field-row').forEach(row => {
    row.classList.remove('drag-over');
  });
}

function handleGuestDragEnter(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleGuestDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const row = event.target.closest('.guest-field-row');
  if (row) row.classList.add('drag-over');
}

function handleGuestDragLeave(event) {
  const row = event.target.closest('.guest-field-row');
  if (row) row.classList.remove('drag-over');
}

function handleGuestDrop(event, targetRoomIndex, targetGuestIndex) {
  event.preventDefault();
  event.stopPropagation();
  const row = event.target.closest('.guest-field-row');
  if (row) row.classList.remove('drag-over');
  
  const data = event.dataTransfer.getData('text/plain');
  if (!data) return;
  const parts = data.split(',');
  if (parts.length !== 2) return;
  
  const sourceRoomIndex = parseInt(parts[0], 10);
  const sourceGuestIndex = parseInt(parts[1], 10);

  if (sourceRoomIndex === targetRoomIndex && sourceGuestIndex === targetGuestIndex) return;

  const rooms = getRooms();
  if (!rooms[sourceRoomIndex] || !rooms[targetRoomIndex]) return;
  
  const sourceGuests = rooms[sourceRoomIndex].guests;
  const targetGuests = rooms[targetRoomIndex].guests;
  
  if (sourceRoomIndex !== targetRoomIndex) {
    const movedGuest = sourceGuests.splice(sourceGuestIndex, 1)[0];
    
    if (!targetGuests[targetGuestIndex]) {
       targetGuests[targetGuestIndex] = movedGuest;
    } else {
       targetGuests.splice(targetGuestIndex, 0, movedGuest);
    }
    
    rooms[sourceRoomIndex].guest_count = Math.max(0, sourceGuests.filter(Boolean).length);
    rooms[targetRoomIndex].guest_count = Math.max(0, targetGuests.filter(Boolean).length);
  } else {
    const temp = sourceGuests[sourceGuestIndex];
    sourceGuests[sourceGuestIndex] = targetGuests[targetGuestIndex];
    targetGuests[targetGuestIndex] = temp;
  }
  
  setRooms(rooms);
  handleDetailChange();
}

function updateRoomField(index, field, value) {
  const rooms = getRooms();
  if (!rooms[index]) return;
  rooms[index] = { ...rooms[index], [field]: value };
  setRooms(rooms);
}

function updateRoomGuestCount(index, value) {
  const rooms = getRooms();
  const nextCount = Math.max(0, parseInt(value, 10) || 0);
  rooms[index] = normalizeRoom({ ...rooms[index], guest_count: nextCount });
  setRooms(rooms);
}

function addRoomGuest(roomIndex, guestIndex) {
  const rooms = getRooms();
  if (!rooms[roomIndex]) return;
  rooms[roomIndex].guests.splice(guestIndex + 1, 0, '');
  rooms[roomIndex].guest_count = rooms[roomIndex].guests.length;
  setRooms(rooms);
}

function removeRoomGuest(roomIndex, guestIndex) {
  const rooms = getRooms();
  if (!rooms[roomIndex]) return;
  rooms[roomIndex].guests.splice(guestIndex, 1);
  rooms[roomIndex].guest_count = rooms[roomIndex].guests.length;
  setRooms(rooms);
}

function updateRoomGuestName(index, guestIndex, value) {
  const rooms = getRooms();
  if (!rooms[index]) return;
  const room = normalizeRoom(rooms[index]);
  room.guests[guestIndex] = value;
  rooms[index] = room;
  setRooms(rooms);
}

function updatePrimaryGuest(value) {
  const input = document.getElementById('f_guest_name');
  if (input) input.dataset.autoPrimary = 'false';
  const rooms = getRooms();
  if (!rooms.length) {
    setRooms([{ room_type: '', guest_count: 1, guests: [value], guest_summary: '' }]);
    return;
  }
  const firstRoom = normalizeRoom(rooms[0]);
  firstRoom.guests[0] = value;
  rooms[0] = firstRoom;
  setRooms(rooms);
}

function updatePrimaryRoomType(value) {
  const input = document.getElementById('f_room_type');
  if (input) input.dataset.autoRoomType = 'false';
  const rooms = getRooms();
  if (!rooms.length) {
    setRooms([{ room_type: value, guest_count: 1, guests: [''], guest_summary: '' }]);
    return;
  }
  rooms[0] = normalizeRoom({ ...rooms[0], room_type: value });
  setRooms(rooms);
}

function getAmenities() {
  return Array.isArray(currentBooking?.amenities) ? [...currentBooking.amenities] : [];
}

function setAmenities(nextAmenities) {
  if (!currentBooking) return;
  currentBooking.amenities = nextAmenities.filter(Boolean).map(a => String(a).trim()).filter(Boolean);
  document.getElementById('amenityList').innerHTML = currentBooking.amenities.length
    ? currentBooking.amenities.map((a, i) => `
      <span class="amenity-chip">
        <span>${esc(a)}</span>
        <span class="amenity-chip-actions">
          <button type="button" class="chip-icon-btn" title="Edit amenity" onclick="editAmenity(${i})"><span style="display:inline-block;transform:scaleX(-1);">&#9998;</span></button>
          <button type="button" class="chip-icon-btn" title="Delete amenity" onclick="removeAmenity(${i})">&times;</button>
        </span>
      </span>`).join('')
    : '<span style="color:#94a3b8;font-size:.85rem">No amenities added yet</span>';
}

function renderAmenitiesEditor(amenities) {
  const items = Array.isArray(amenities) ? amenities : [];
  const chips = items.length
    ? items.map((a, i) => `
      <span class="amenity-chip">
        <span>${esc(a)}</span>
        <span class="amenity-chip-actions">
          <button type="button" class="chip-icon-btn" title="Edit amenity" onclick="editAmenity(${i})"><span style="display:inline-block;transform:scaleX(-1);">&#9998;</span></button>
          <button type="button" class="chip-icon-btn" title="Delete amenity" onclick="removeAmenity(${i})">&times;</button>
        </span>
      </span>`).join('')
    : '<span style="color:#94a3b8;font-size:.85rem">No amenities added yet</span>';
  return `
    <div id="amenityList" class="amenity-chips">${chips}</div>
    <div class="amenity-add-row">
      <input id="f_new_amenity" type="text" placeholder="Add amenity" onkeydown="if(event.key==='Enter'){event.preventDefault();addAmenity();}">
      <button type="button" class="btn btn-secondary btn-sm" onclick="addAmenity()">Add</button>
    </div>`;
}

function addAmenity() {
  const input = document.getElementById('f_new_amenity');
  const value = input?.value?.trim();
  if (!value) return;
  setAmenities([...getAmenities(), value]);
  input.value = '';
}

function editAmenity(index) {
  const amenities = getAmenities();
  const currentValue = amenities[index];
  if (currentValue == null) return;
  const nextValue = window.prompt('Edit amenity', currentValue);
  if (nextValue == null) return;
  amenities[index] = nextValue.trim();
  setAmenities(amenities);
}

function removeAmenity(index) {
  const amenities = getAmenities();
  amenities.splice(index, 1);
  setAmenities(amenities);
}

function togglePaidLogo() {
  if (!currentBooking) return;
  currentBooking.show_paid_logo = !currentBooking.show_paid_logo;
  const btn = document.getElementById('paidLogoToggle');
  if (btn) {
    btn.classList.toggle('active', Boolean(currentBooking.show_paid_logo));
    btn.textContent = currentBooking.show_paid_logo ? 'Paid in Full: On' : 'Paid in Full: Off';
  }
}

function triggerImageUpload() {
  document.getElementById('imgUploadInput').click();
}

async function uploadImageFormData(fd) {
  showLoading(true);
  try {
    const r = await fetch('/api/hotels/upload-image', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) { showToast(j.error || 'Upload failed', 'error'); return; }
    uploadedImageUrl = j.image_url;
    if (currentBooking) currentBooking.image_url = j.image_url;
    const imgElem = document.getElementById('detailImg');
    if (imgElem) {
      imgElem.outerHTML = `<img id="detailImg" src="${j.image_url}" alt="Hotel">`;
    }
    showToast('Image updated');
  } finally {
    showLoading(false);
  }
}

async function uploadCustomImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('image', file);
  await uploadImageFormData(fd);
}

async function saveDetail() {
  if (!currentBooking) return;
  const rooms = getRooms();
  const roomSummary = buildRoomSummary(rooms);
  const payload = {
    booking_id: document.getElementById('f_booking_id').value,
    hotel_name: document.getElementById('f_hotel_name').value,
    hotel_phone: document.getElementById('f_hotel_phone').value,
    hotel_address: document.getElementById('f_hotel_address').value,
    guest_name: document.getElementById('f_guest_name').value || roomSummary.guest_name,
    num_guests: parseInt(document.getElementById('f_num_guests')?.value) || roomSummary.num_guests || 1,
    check_in_date: document.getElementById('f_check_in_date').value || null,
    check_in_time: document.getElementById('f_check_in_time').value || null,
    check_out_date: document.getElementById('f_check_out_date').value || null,
    check_out_time: document.getElementById('f_check_out_time').value || null,
    room_type: document.getElementById('f_room_type').value || roomSummary.room_type,
    room_count: parseInt(document.getElementById('f_room_count')?.value) || roomSummary.room_count || 1,
    rooms,
    meal_plan: document.getElementById('f_meal_plan').value,
    currency: document.getElementById('f_currency').value,
    total_amount: parseAmountInput(document.getElementById('f_total_amount').value),
    amenities: getAmenities(),
    special_instructions: window.quill ? window.quill.root.innerHTML : '',
    image_url: uploadedImageUrl || currentBooking.image_url,
    show_paid_logo: Boolean(currentBooking.show_paid_logo),
  };
  showLoading(true);
  try {
    const r = await fetch(`/api/hotels/${currentBooking.id}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok) { showToast(j.error || 'Save failed', 'error'); return; }
    Object.assign(currentBooking, j.data);
    showToast('Saved');
  } finally {
    showLoading(false);
  }
}

async function deleteBooking(id) {
  if (!confirm('Delete this hotel booking?')) return;
  showLoading(true);
  try {
    await fetch(`/api/hotels/${id}`, { method: 'DELETE' });
    bookings = bookings.filter(b => b.id != id);
    closeDetail();
  } finally {
    showLoading(false);
  }
}

function deleteCurrentBooking() {
  if (currentBooking && currentBooking.id) {
    deleteBooking(currentBooking.id);
  }
}

function downloadPDF(id) {
  if (!currentBooking || currentBooking.id !== id) {
    window.open(`/api/hotels/${id}/pdf`, '_blank');
    return;
  }
  const rooms = currentBooking ? getRooms() : [];
  const roomSummary = buildRoomSummary(rooms);
  const payload = {
    booking_id: document.getElementById('f_booking_id')?.value,
    hotel_name: document.getElementById('f_hotel_name')?.value,
    hotel_phone: document.getElementById('f_hotel_phone')?.value,
    hotel_address: document.getElementById('f_hotel_address')?.value,
    guest_name: document.getElementById('f_guest_name')?.value || roomSummary.guest_name,
    num_guests: parseInt(document.getElementById('f_num_guests')?.value) || roomSummary.num_guests || 1,
    check_in_date: document.getElementById('f_check_in_date')?.value || null,
    check_in_time: document.getElementById('f_check_in_time')?.value || null,
    check_out_date: document.getElementById('f_check_out_date')?.value || null,
    check_out_time: document.getElementById('f_check_out_time')?.value || null,
    room_type: document.getElementById('f_room_type')?.value || roomSummary.room_type,
    room_count: parseInt(document.getElementById('f_room_count')?.value) || roomSummary.room_count || 1,
    rooms,
    meal_plan: document.getElementById('f_meal_plan')?.value,
    currency: document.getElementById('f_currency')?.value,
    total_amount: parseAmountInput(document.getElementById('f_total_amount')?.value),
    amenities: getAmenities(),
    special_instructions: window.quill ? window.quill.root.innerHTML : '',
    uploaded_image_url: uploadedImageUrl || null,
    image_url: uploadedImageUrl || currentBooking?.image_url,
    show_paid_logo: Boolean(currentBooking?.show_paid_logo),
  };
  fetch(`/api/hotels/${id}/pdf`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  }).then(triggerDownloadFromResponse);
}

function buildRoomSummary(roomsInput) {
  const rooms = Array.isArray(roomsInput) ? roomsInput.filter(Boolean) : [];
  const roomCount = rooms.length || null;
  const firstRoomType = rooms.find(room => room.room_type)?.room_type || '';
  let primaryGuestName = '';
  let countedGuests = 0;
  let fallbackSummary = '';
  rooms.forEach(room => {
    const guests = Array.isArray(room.guests) ? room.guests.filter(Boolean) : [];
    countedGuests += Math.max(guests.length, parseInt(room.guest_count, 10) || 0);
    if (!primaryGuestName && guests.length) primaryGuestName = guests[0];
    if (!fallbackSummary && room.guest_summary) fallbackSummary = room.guest_summary;
  });
  return {
    room_count: roomCount,
    room_type: firstRoomType,
    num_guests: countedGuests || null,
    guest_name: primaryGuestName || fallbackSummary || '',
  };
}

function setRooms(nextRooms) {
  if (!currentBooking) return;
  currentBooking.rooms = nextRooms.map(normalizeRoom);
  const list = document.getElementById('roomList');
  if (list) list.innerHTML = renderRoomCards(currentBooking.rooms);
  updateDetailHeaderPreview();
}

function setAmenities(nextAmenities) {
  if (!currentBooking) return;
  currentBooking.amenities = nextAmenities.filter(Boolean).map(a => String(a).trim()).filter(Boolean);
  const list = document.getElementById('amenityList');
  if (list) {
    list.innerHTML = currentBooking.amenities.length
      ? currentBooking.amenities.map((a, i) => `
        <span class="amenity-chip">
          <span>${esc(a)}</span>
          <span class="amenity-chip-actions">
            <button type="button" class="chip-icon-btn" title="Edit amenity" onclick="editAmenity(${i})"><span style="display:inline-block;transform:scaleX(-1);">&#9998;</span></button>
            <button type="button" class="chip-icon-btn" title="Delete amenity" onclick="removeAmenity(${i})">&times;</button>
          </span>
        </span>`).join('')
      : '<span style="color:#94a3b8;font-size:.85rem">No amenities added yet</span>';
  }
  updateDetailHeaderPreview();
}

async function saveDetail() {
  if (!currentBooking) return;
  const btn = document.getElementById('saveChangesBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:4px;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16" stroke-linecap="round"></circle></svg> Saving...`;
  }
  
  const rooms = getRooms();
  const roomSummary = buildRoomSummary(rooms);
  const currencyValue = getCurrencyValue();
  const payload = {
    booking_id: document.getElementById('f_booking_id').value,
    hotel_name: document.getElementById('f_hotel_name').value,
    hotel_phone: document.getElementById('f_hotel_phone').value,
    hotel_address: document.getElementById('f_hotel_address').value,
    guest_name: document.getElementById('f_guest_name').value || roomSummary.guest_name,
    num_guests: parseInt(document.getElementById('f_num_guests')?.value) || roomSummary.num_guests || 1,
    check_in_date: document.getElementById('f_check_in_date').value || null,
    check_in_time: document.getElementById('f_check_in_time').value || null,
    check_out_date: document.getElementById('f_check_out_date').value || null,
    check_out_time: document.getElementById('f_check_out_time').value || null,
    room_type: document.getElementById('f_room_type').value || roomSummary.room_type,
    room_count: parseInt(document.getElementById('f_room_count')?.value) || roomSummary.room_count || 1,
    rooms,
    meal_plan: document.getElementById('f_meal_plan').value,
    currency: currencyValue,
    total_amount: parseAmountInput(document.getElementById('f_total_amount').value),
    amenities: getAmenities(),
    special_instructions: window.quill ? window.quill.root.innerHTML : '',
    image_url: uploadedImageUrl || currentBooking.image_url || RESORT_FALLBACK_IMAGE,
    show_paid_logo: Boolean(currentBooking.show_paid_logo),
  };
  try {
    const r = await fetch(`/api/hotels/${currentBooking.id}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok) { showToast(j.error || 'Save failed', 'error'); return; }
    Object.assign(currentBooking, j.data);
    bookings = bookings.map(item => item.id === j.data.id ? { ...item, ...j.data } : item);
    showToast('Saved');
    updateDetailHeaderPreview();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `Save Changes`;
    }
  }
}

function downloadPDF(id, btnElement = null) {
  const isCurrent = Boolean(currentBooking && currentBooking.id === id);
  const btn = btnElement || (isCurrent ? document.getElementById('downloadPdfBtn') : null);
  let originalText = btn ? btn.innerHTML : '';
  
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:4px;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16" stroke-linecap="round"></circle></svg> Generating...`;
  }

  if (!isCurrent) {
    fetch(`/api/hotels/${id}/pdf`, { method: 'GET' })
      .then(triggerDownloadFromResponse)
      .finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      });
    return;
  }
  const rooms = getRooms();
  const roomSummary = buildRoomSummary(rooms);
  const currencyValue = getCurrencyValue();
  const payload = {
    booking_id: document.getElementById('f_booking_id')?.value,
    hotel_name: document.getElementById('f_hotel_name')?.value,
    hotel_phone: document.getElementById('f_hotel_phone')?.value,
    hotel_address: document.getElementById('f_hotel_address')?.value,
    guest_name: document.getElementById('f_guest_name')?.value || roomSummary.guest_name,
    num_guests: parseInt(document.getElementById('f_num_guests')?.value) || roomSummary.num_guests || 1,
    check_in_date: document.getElementById('f_check_in_date')?.value || null,
    check_in_time: document.getElementById('f_check_in_time')?.value || null,
    check_out_date: document.getElementById('f_check_out_date')?.value || null,
    check_out_time: document.getElementById('f_check_out_time')?.value || null,
    room_type: document.getElementById('f_room_type')?.value || roomSummary.room_type,
    room_count: parseInt(document.getElementById('f_room_count')?.value) || roomSummary.room_count || 1,
    rooms,
    meal_plan: document.getElementById('f_meal_plan')?.value,
    currency: currencyValue,
    total_amount: parseAmountInput(document.getElementById('f_total_amount')?.value),
    amenities: getAmenities(),
    special_instructions: window.quill ? window.quill.root.innerHTML : '',
    uploaded_image_url: uploadedImageUrl || null,
    image_url: uploadedImageUrl || currentBooking?.image_url || RESORT_FALLBACK_IMAGE,
    show_paid_logo: Boolean(currentBooking?.show_paid_logo),
  };
  fetch(`/api/hotels/${id}/pdf`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  }).then(triggerDownloadFromResponse).finally(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText || `Download PDF`;
    }
  });
}

function formatHotelDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  let dt = null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  } else {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) dt = parsed;
  }
  if (!dt || Number.isNaN(dt.getTime())) return raw;
  const day = String(dt.getDate()).padStart(2, '0');
  const month = dt.toLocaleString('en-US', { month: 'long' });
  const year = String(dt.getFullYear()).slice(-2);
  return `${day} ${month} ${year}`;
}

function getCurrencyValue() {
  const select = document.getElementById('f_currency_select');
  const custom = document.getElementById('f_currency_custom');
  if (!select) {
    return (currentBooking?.currency || 'INR').toUpperCase();
  }
  if (select.value === 'custom') {
    return (custom?.value || '').trim().toUpperCase() || 'INR';
  }
  return select.value || 'INR';
}

function applyCurrencySelection(currency) {
  const select = document.getElementById('f_currency_select');
  const custom = document.getElementById('f_currency_custom');
  if (!select || !custom) return;
  const normalized = String(currency || '').trim().toUpperCase();
  if (CURRENCY_OPTIONS.includes(normalized)) {
    select.value = normalized;
    custom.style.display = 'none';
    custom.value = '';
  } else {
    select.value = 'custom';
    custom.style.display = 'block';
    custom.value = normalized || '';
  }
}

function updateDetailHeaderPreview() {
  const title = (document.getElementById('f_hotel_name')?.value || currentBooking?.hotel_name || 'Hotel Booking').trim();
  const ref = (document.getElementById('f_booking_id')?.value || currentBooking?.booking_id || currentBooking?.booking_confirmation || '').trim();
  const roomSummary = buildRoomSummary(getRooms());
  const guest = (document.getElementById('f_guest_name')?.value || roomSummary.guest_name || currentBooking?.guest_name || '').trim();
  const checkIn = formatHotelDate(document.getElementById('f_check_in_date')?.value || currentBooking?.check_in_date || '');
  const checkOut = formatHotelDate(document.getElementById('f_check_out_date')?.value || currentBooking?.check_out_date || '');
  const parts = [];
  if (ref) parts.push(`Ref ${ref}`);
  if (guest) parts.push(guest);
  if (checkIn || checkOut) parts.push([checkIn, checkOut].filter(Boolean).join(' - '));
  const subtitle = parts.join(' · ');
  const headerTitleNode = document.getElementById('detailTitle');
  const headerSubtitleNode = document.getElementById('detailPageSubtitle');
  const titleNode = document.getElementById('detailHeroName');
  const subtitleNode = document.getElementById('detailSubtitle');
  if (headerTitleNode) headerTitleNode.textContent = title;
  if (headerSubtitleNode) headerSubtitleNode.textContent = subtitle;
  if (titleNode) titleNode.textContent = title;
  if (subtitleNode) subtitleNode.textContent = subtitle;
}

function syncHotelWarningUi() {
  const phoneInputs = document.querySelectorAll('#f_hotel_phone');
  phoneInputs.forEach(phoneInput => {
    const raw = String(phoneInput.value || '').trim();
    const digitsOnly = raw.replace(/\D/g, '');
    const invalidPhone = raw.length > 0 && (digitsOnly.length < 7 || raw.length > 15);
    const missingPhone = raw.length === 0;
    const isInvalid = invalidPhone || missingPhone;
    
    const phoneGroup = phoneInput.closest('.input-group');
    if (phoneGroup) {
      if (isInvalid) {
        phoneGroup.classList.add('warning');
        if (!phoneGroup.querySelector('.field-warning-badge')) {
          const labelEl = phoneGroup.querySelector('label');
          if (labelEl) {
            labelEl.insertAdjacentHTML('beforeend', '<span class="field-warning-badge" title="Phone number is missing, too short, or too long">&#9888;</span>');
          }
        }
      } else {
        phoneGroup.classList.remove('warning');
        const badge = phoneGroup.querySelector('.field-warning-badge');
        if (badge) badge.remove();
      }
    }
  });

  const addressInputs = document.querySelectorAll('#f_hotel_address');
  addressInputs.forEach(addressInput => {
    const raw = String(addressInput.value || '').trim();
    const isInvalid = raw.length === 0;
    
    const addressGroup = addressInput.closest('.input-group');
    if (addressGroup) {
      if (isInvalid) {
        addressGroup.classList.add('warning');
        if (!addressGroup.querySelector('.field-warning-badge')) {
          const labelEl = addressGroup.querySelector('label');
          if (labelEl) {
            labelEl.insertAdjacentHTML('beforeend', '<span class="field-warning-badge" title="Address is missing">&#9888;</span>');
          }
        }
      } else {
        addressGroup.classList.remove('warning');
        const badge = addressGroup.querySelector('.field-warning-badge');
        if (badge) badge.remove();
      }
    }
  });
}

function handleDetailChange() {
  if (!currentBooking) return;
  updateDetailHeaderPreview();
  syncHotelWarningUi();
}

function renderCard(b) {
  const imageSrc = b.image_url || RESORT_FALLBACK_IMAGE;
  const imageClass = imageSrc === RESORT_FALLBACK_IMAGE ? 'fallback-fit' : '';
  const amount = formatHotelAmount(b);
  const dateRange = [formatHotelDate(b.check_in_date), formatHotelDate(b.check_out_date)].filter(Boolean).join(' - ');
  return `
    <div class="hotel-card" onclick="openDetailRoute('${b.id}')">
      <div class="hotel-card-img">
        <img class="${imageClass}" src="${imageSrc}" alt="${esc(b.hotel_name || 'Hotel')}" onerror="this.classList.add('fallback-fit');this.onerror=null;this.src='${RESORT_FALLBACK_IMAGE}'">
      </div>
      <div class="hotel-card-body">
        <div class="hotel-card-name">${esc(b.hotel_name || 'Unknown Hotel')}</div>
        <div class="hotel-card-meta">${formatCardMeta(b)}</div>
        <div class="hotel-card-dates">
          ${dateRange ? `<span class="date-range">${esc(dateRange)}</span>` : ''}
        </div>
        <div class="hotel-card-footer">
          ${amount ? `<span class="hotel-amount">${amount}</span>` : '<span></span>'}
          <div class="hotel-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-pdf btn-sm" onclick="downloadPDF('${b.id}', this)">PDF</button>
          </div>
        </div>
      </div>
    </div>`;
}

function formatCardMeta(b) {
  const rooms = getRoomsForDisplay(b);
  const roomCount = rooms.length || b?.room_count || 0;
  const guestCount = b?.num_guests || rooms.reduce((sum, room) => sum + ((room.guests || []).length || 0), 0);
  const leadGuest = b?.guest_name || rooms.flatMap(room => room.guests || [])[0] || '';
  const parts = [];
  if (leadGuest) parts.push(leadGuest);
  if (roomCount) parts.push(`${roomCount} room${roomCount > 1 ? 's' : ''}`);
  if (guestCount) parts.push(`${guestCount} guest${guestCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function buildDetailHTML(b) {
  const rooms = getRoomsForDisplay(b);
  const amenities = Array.isArray(b.amenities) ? b.amenities : [];
  const imageSrc = b.image_url || RESORT_FALLBACK_IMAGE;
  const imageClass = imageSrc === RESORT_FALLBACK_IMAGE ? 'fallback-fit' : '';
  const bookingRef = esc(b.booking_id || b.booking_confirmation || '');
  const guestName = esc(b.guest_name || '');
  const stayLabel = [formatHotelDate(b.check_in_date), formatHotelDate(b.check_out_date)].filter(Boolean).join(' - ');
  return `
    <div class="detail-sections">
      <section class="section-card hero-card">
        <div class="detail-img-wrap hero-image" id="detailImgWrap" title="Paste an image into this booking">
          <div class="img-paste-hint">Ctrl+V / Cmd+V to paste image</div>
          <img id="detailImg" class="${imageClass}" src="${imageSrc}" alt="Hotel" onerror="this.classList.add('fallback-fit');this.onerror=null;this.src='${RESORT_FALLBACK_IMAGE}'">
          <button class="img-overlay-btn" type="button" onclick="triggerImageUpload()">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            Upload Image
          </button>
        </div>
        <input type="file" id="imgUploadInput" accept="image/*" style="display:none" onchange="uploadCustomImage(this)">
        <div class="hero-copy">
          <div class="hero-top-row">
            <div>
              <div class="hero-kicker">Hotel Booking</div>
              <h3 class="hero-title" id="detailHeroName">${esc(b.hotel_name || 'Hotel Booking')}</h3>
              <div class="hero-subtitle" id="detailSubtitle">${[bookingRef ? `Ref ${bookingRef}` : '', guestName, stayLabel].filter(Boolean).join(' · ')}</div>
            </div>
            <div class="hero-meta">
              ${bookingRef ? `<span class="info-pill">Ref ${bookingRef}</span>` : ''}
              ${formatHotelDate(b.check_in_date) ? `<span class="info-pill">In ${formatHotelDate(b.check_in_date)}</span>` : ''}
              ${formatHotelDate(b.check_out_date) ? `<span class="info-pill">Out ${formatHotelDate(b.check_out_date)}</span>` : ''}
            </div>
          </div>
          <div class="hero-description">${esc(b.hotel_address || 'Hotel details and stay information are organized below.')}</div>
        </div>
      </section>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Hotel Details</div>
            <div class="section-card-subtitle">Basic property and contact information</div>
          </div>
        </div>
        <div class="compact-grid">
          <div class="input-group"><label>Hotel Name</label><input id="f_hotel_name" value="${esc(b.hotel_name || '')}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Phone</label><input id="f_hotel_phone" value="${esc(b.hotel_phone || '')}" oninput="handleDetailChange()"></div>
          <div class="input-group full-span"><label>Address</label><input id="f_hotel_address" value="${esc(b.hotel_address || '')}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Booking Reference</label><input id="f_booking_id" value="${bookingRef}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Primary Guest</label><input id="f_guest_name" value="${guestName}" oninput="updatePrimaryGuest(this.value); handleDetailChange()"></div>
        </div>
      </section>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Stay Details</div>
            <div class="section-card-subtitle">Dates, times, room count, and meal plan</div>
          </div>
        </div>
        <div class="compact-grid">
          <div class="input-group"><label>Check-in Date</label><input id="f_check_in_date" type="date" value="${b.check_in_date || ''}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Check-out Date</label><input id="f_check_out_date" type="date" value="${b.check_out_date || ''}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Check-in Time</label><input id="f_check_in_time" value="${esc(b.check_in_time || '')}" placeholder="2:00 PM" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Check-out Time</label><input id="f_check_out_time" value="${esc(b.check_out_time || '')}" placeholder="11:00 AM" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Total Guests</label><input id="f_num_guests" type="number" min="1" value="${b.num_guests || 1}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Room Count</label><input id="f_room_count" type="number" min="1" value="${b.room_count || Math.max(1, rooms.length || 1)}" oninput="handleDetailChange()"></div>
          <div class="input-group"><label>Room Type</label><input id="f_room_type" value="${esc(b.room_type || '')}" oninput="updatePrimaryRoomType(this.value); handleDetailChange()"></div>
          <div class="input-group"><label>Meal Plan</label><input id="f_meal_plan" value="${esc(b.meal_plan || '')}" oninput="handleDetailChange()"></div>
          <div class="input-group currency-field">
            <label>Currency</label>
            <div class="currency-stack">
              <select id="f_currency_select" onchange="applyCurrencySelection(this.value); handleDetailChange()">
                ${CURRENCY_OPTIONS.map(cur => `<option value="${cur}">${cur}</option>`).join('')}
                <option value="custom">Custom</option>
              </select>
              <input id="f_currency_custom" type="text" placeholder="Custom currency code" style="display:none" oninput="handleDetailChange()">
            </div>
          </div>
          <div class="input-group"><label>Total Amount</label><input id="f_total_amount" type="text" inputmode="decimal" value="${b.total_amount ?? ''}" oninput="handleDetailChange()"></div>
        </div>
      </section>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Rooms & Guests</div>
            <div class="section-card-subtitle">Edit room level guest names and summaries</div>
          </div>
        </div>
        ${renderRoomsEditor(rooms)}
      </section>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Amenities</div>
            <div class="section-card-subtitle">Add chips without crowding the layout</div>
          </div>
        </div>
        ${renderAmenitiesEditor(amenities)}
      </section>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Special Instructions</div>
            <div class="section-card-subtitle">Optional notes for the voucher and internal use</div>
          </div>
        </div>
        <div class="input-group compact-textarea" style="margin-bottom: 2rem;"><label>Special Instructions</label><div id="f_special_instructions_editor" style="min-height:150px; background: white;"></div></div>
      </section>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Actions</div>
            <div class="section-card-subtitle">Save, print, or remove this booking</div>
          </div>
        </div>
        <div class="detail-actions" style="align-items:center;">
          <button class="btn btn-primary" id="saveChangesBtn" type="button" onclick="saveDetail()">Save Changes</button>
          <div style="display:flex; align-items:center; gap:0.5rem; margin-right:auto; margin-left:0.5rem;">
            <span style="font-size:0.9rem; color:#475569; font-weight:600;">Paid in Full</span>
            <label class="switch">
              <input type="checkbox" id="paidLogoToggle" onchange="togglePaidLogo()">
              <span class="slider round"></span>
            </label>
          </div>
          <button class="btn btn-secondary" type="button" onclick="openSpecialRequestModal()">Special Requests</button>
          <button class="btn btn-pdf" id="downloadPdfBtn" type="button" onclick="downloadPDF('${b.id}', this)">Download PDF</button>
          <button class="btn btn-danger" type="button" onclick="deleteBooking('${b.id}')">Delete</button>
        </div>
      </section>
    </div>`;
}

function renderDetail(b) {
  currentBookingSnapshot = { ...b };
  document.getElementById('detailBody').innerHTML = buildDetailHTML(b);
  applyCurrencySelection(b.currency || 'INR');
  updateDetailHeaderPreview();
  const paidToggle = document.getElementById('paidLogoToggle');
  if (paidToggle) {
    paidToggle.checked = Boolean(b.show_paid_logo);
  }
  document.getElementById('hotelDetailPage').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  syncHotelWarningUi();
}

function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function showLoading(v){ document.getElementById('loadingOverlay').classList.toggle('active', v); }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'error' ? '#ef4444' : '#0f172a';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
const SPECIAL_REQUEST_OPTIONS = [
  "Early check-in or late check-out",
  "High-floor room",
  "Room with a view",
  "King-size bed instead of twin beds",
  "Extra pillows or blankets",
  "Non-smoking room",
  "Quiet room away from elevators",
  "Connecting/adjoining rooms",
  "Crib/baby cot for infants",
  "Extra bed/rollaway bed",
  "Airport pickup/drop-off",
  "Birthday or anniversary room decoration",
  "Honeymoon arrangements",
  "Special dietary requirements (vegetarian, vegan, gluten-free, etc.)",
  "Wheelchair-accessible room",
  "Pet-friendly room",
  "Wake-up call service",
  "Mini-fridge or microwave in room",
  "Extra toiletries",
  "Luggage storage before check-in or after check-out"
];

let selectedSpecialRequests = new Set();

function openSpecialRequestModal() {
  selectedSpecialRequests.clear();
  renderSpecialRequestChips();
  updateSpecialRequestEmailText();
  document.getElementById('specialRequestModalOverlay').classList.add('open');
}

function closeSpecialRequestModal() {
  document.getElementById('specialRequestModalOverlay').classList.remove('open');
}

function renderSpecialRequestChips() {
  const container = document.getElementById('specialRequestChips');
  if (!container) return;
  container.innerHTML = SPECIAL_REQUEST_OPTIONS.map((req, i) => {
    const isSelected = selectedSpecialRequests.has(req);
    const bg = isSelected ? '#10b981' : '#f8fafc';
    const color = isSelected ? '#fff' : '#475569';
    const border = isSelected ? '#059669' : '#e2e8f0';
    return `<button class="amenity-chip" style="cursor:pointer; background: ${bg}; color: ${color}; border-color: ${border}; transition: all 0.2s;" onclick="toggleSpecialRequest(${i})">${esc(req)}</button>`;
  }).join('');
}

function toggleSpecialRequest(index) {
  const req = SPECIAL_REQUEST_OPTIONS[index];
  if (selectedSpecialRequests.has(req)) {
    selectedSpecialRequests.delete(req);
  } else {
    selectedSpecialRequests.add(req);
  }
  renderSpecialRequestChips();
  updateSpecialRequestEmailText();
}

function copySpecialRequestEmail() {
  const text = document.getElementById('specialRequestEmailText').value;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast('Email copied to clipboard!'));
  } else {
    const ta = document.getElementById('specialRequestEmailText');
    ta.select();
    document.execCommand('copy');
    showToast('Email copied to clipboard!');
  }
}

let generatedEmailSubject = "";

function openSpecialRequestInGmail() {
  const emailBody = document.getElementById('specialRequestEmailText').value;
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(generatedEmailSubject)}&body=${encodeURIComponent(emailBody)}`;
  window.open(gmailUrl, '_blank');
}

function updateSpecialRequestEmailText() {
  if (!currentBooking) return;
  const requests = Array.from(selectedSpecialRequests);
  
  let requestsList = "* No special requests selected";
  if (requests.length > 0) {
    requestsList = requests.map(r => '* ' + r).join('\n');
  }
  
  const hotelName = currentBooking.hotel_name || 'Hotel';
  const checkIn = formatHotelDate(currentBooking.check_in_date) || 'Unknown';
  const checkOut = formatHotelDate(currentBooking.check_out_date) || 'Unknown';
  
  let primaryGuest = currentBooking.guest_name || '';
  if (!primaryGuest && currentBooking.rooms && currentBooking.rooms[0] && currentBooking.rooms[0].guests && currentBooking.rooms[0].guests[0]) {
    primaryGuest = currentBooking.rooms[0].guests[0];
  }
  if (!primaryGuest) primaryGuest = 'Guest';
  
  const bookingId = currentBooking.booking_id || currentBooking.booking_confirmation || 'N/A';
  
  generatedEmailSubject = `Special Requests for Booking: ${primaryGuest} - ${hotelName}`;
  const generatedEmailBody = `Dear Reservations Team,

I hope you are doing well.

I have an upcoming reservation at your hotel and would like to request a few preferences for my stay.

Booking Details

* Guest Name: ${primaryGuest}
* Booking Reference: ${bookingId}
* Stay Dates: ${checkIn} – ${checkOut}

I would greatly appreciate it if you could accommodate the following requests, subject to availability:

${requestsList}

I understand that these requests cannot be guaranteed and are subject to hotel availability. However, I would be grateful if you could let me know whether they can be arranged.

Thank you for your assistance. I look forward to staying with you.

Kind regards,

${primaryGuest}`;

  document.getElementById('specialRequestEmailText').value = generatedEmailBody;
}
