// ==================== STATE ====================
let allTickets = [];
let currentTicket = null;
let currentFilter = 'all';
let editedData = {};

// ==================== SIDEBAR & THEME ====================
function initializeSidebar() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('active');
            sidebarOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }
    const closeSidebar = () => {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    };
    if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
    const savedTheme = localStorage.getItem('theme') || 'light';
    updateTheme(savedTheme);
    const themeBtn = document.getElementById('sidebarThemeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            updateTheme(next);
        });
    }
}
function updateTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const text = document.getElementById('themeToggleText');
    const icon = document.querySelector('.theme-icon-container');
    if (text && icon) {
        if (theme === 'dark') { icon.textContent = '☀️'; text.textContent = 'Light Mode'; }
        else { icon.textContent = '🌙'; text.textContent = 'Dark Mode'; }
    }
}

// ==================== AUTH ====================
async function checkAuth() {
    try {
        const r = await fetch('/api/user');
        if (!r.ok) { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); return; }
        const u = await r.json();
        const nameEl = document.getElementById('sidebarUserName');
        if (nameEl) nameEl.textContent = u.full_name || u.username;
        const emailEl = document.getElementById('sidebarUserEmail');
        if (emailEl) emailEl.textContent = u.email || 'Member';
        const avatarEl = document.getElementById('sidebarAvatar');
        if (avatarEl) avatarEl.textContent = (u.full_name || u.username).charAt(0).toUpperCase();
        const authBtn = document.getElementById('sidebarAuthBtn');
        if (authBtn) {
            authBtn.textContent = '🚪 Logout';
            authBtn.classList.add('logout');
            authBtn.onclick = async () => { if (confirm('Logout?')) { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; } };
        }
    } catch (e) { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); }
}
function handleAuthClick() { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); }

// ==================== HELPERS ====================
const safe = (val, fallback = '') => {
    if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified') return fallback;
    return val;
};
function formatCurrency(n, curr) {
    if (!n && n !== 0) return '₹0';
    const sym = (curr === 'USD') ? '$' : (curr === 'EUR') ? '€' : '₹';
    return sym + Number(n).toLocaleString('en-IN');
}
function formatDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function showToast(msg, type = 'info') {
    const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
function getTripLabel(t) {
    switch (t) { case 'round_trip': return 'Round Trip'; case 'multi_city': return 'Multi-City'; default: return 'One Way'; }
}
function getPaxLabel(type) {
    if (!type) return 'Adult';
    const t = type.toUpperCase();
    if (t === 'CHD' || t === 'CNN' || t === 'CHILD') return 'Child';
    if (t === 'INF' || t === 'INFANT') return 'Infant';
    return 'Adult';
}

// ==================== LEG GROUPING ====================
function groupSegmentsIntoLegs(segments) {
    if (!segments || segments.length === 0) return [];
    const legs = [];
    let currentLeg = [0];
    for (let i = 1; i < segments.length; i++) {
        const prevArr = (segments[i - 1].arrival || {}).airport || '';
        const currDep = (segments[i].departure || {}).airport || '';
        const hasLayover = segments[i].layover_duration && segments[i].layover_duration !== 'N/A';
        if ((prevArr && currDep && prevArr.toUpperCase() === currDep.toUpperCase()) || hasLayover) {
            currentLeg.push(i);
        } else {
            legs.push(currentLeg);
            currentLeg = [i];
        }
    }
    legs.push(currentLeg);
    return legs;
}

function getLegLabel(legIdx, totalLegs, tripType) {
    if (tripType === 'round_trip') {
        return legIdx === 0 ? 'Outbound' : 'Return';
    } else if (tripType === 'multi_city') {
        return 'Flight ' + (legIdx + 1);
    }
    return 'Flight';
}

// ==================== LOAD DATA ====================
async function loadTickets() {
    try {
        const r = await fetch('/api/tickets/list');
        if (!r.ok) return;
        const d = await r.json();
        allTickets = d.tickets || [];
        renderTicketCards();
    } catch (e) { console.error('Load error:', e); }
}

// ==================== FILTER & CARDS ====================
function filterTickets(status, btn) {
    currentFilter = status;
    document.querySelectorAll('.filter-bar .tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderTicketCards();
}

function renderTicketCards() {
    const container = document.getElementById('ticketCards');
    let items = allTickets;
    const searchInput = document.getElementById('ticketSearch');
    if (searchInput && searchInput.value.trim()) {
        const q = searchInput.value.toLowerCase().trim();
        items = items.filter(t => {
            const pnr = (t.pnr || '').toLowerCase();
            const route = (t.route || '').toLowerCase();
            const names = (t.passenger_names || []).join(' ').toLowerCase();
            return pnr.includes(q) || route.includes(q) || names.includes(q);
        });
    }
    if (currentFilter !== 'all') {
        items = items.filter(t => t.status === currentFilter);
    }
    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <div class="icon">🎫</div>
            <p>${searchInput && searchInput.value ? 'No tickets matched your search.' : 'No tickets found. Tickets will appear here when received from the parser.'}</p>
        </div>`;
        return;
    }
    container.innerHTML = items.map(t => {
        const segments = t.segments || [];
        const passengers = t.passengers || [];
        const journey = t.journey || {};

        // Use journey legs if available (API format has {segments: [idx...], from, to})
        let legs;
        if (journey.legs && journey.legs.length > 0) {
            legs = journey.legs.map(leg => leg.segments || []);
        } else if (t.legs) {
            legs = t.legs;
        } else {
            legs = groupSegmentsIntoLegs(segments);
        }

        // Get overall origin/destination
        const firstLegIndices = legs[0] || [];
        const lastLegIndices = legs[legs.length - 1] || [];
        const firstSeg = segments[firstLegIndices[0]] || segments[0] || {};
        let arrCode = '';
        if (t.trip_type === 'round_trip' && legs.length >= 2) {
            const outboundLastSeg = segments[legs[0][legs[0].length - 1]] || {};
            arrCode = (outboundLastSeg.arrival || {}).airport || '';
        } else {
            const lastSeg = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
            arrCode = (lastSeg.arrival || {}).airport || '';
        }
        const depCode = (firstSeg.departure || {}).airport || '';
        const airline = firstSeg.airline || '';
        const flightNum = firstSeg.flight_number || '';
        const depDate = (firstSeg.departure || {}).date || '';

        // Build route HTML based on trip type
        let routeHtml = '';
        if (t.trip_type === 'multi_city') {
            const dests = [];
            legs.forEach(l => {
                const fs = segments[l[0]] || {};
                const apt = (fs.departure || {}).airport;
                if (apt) dests.push(apt);
            });
            const ls = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
            const finalApt = (ls.arrival || {}).airport;
            if (finalApt) dests.push(finalApt);
            routeHtml = dests.filter(Boolean).map(d => `<span class="route-code">${d}</span>`).join('<span class="route-arrow"> → </span>');
        } else {
            const arrow = t.trip_type === 'round_trip' ? ' ↔ ' : ' → ';
            routeHtml = `<span class="route-code">${depCode}</span><span class="route-arrow">${arrow}</span><span class="route-code">${arrCode}</span>`;
        }

        // Count layovers
        const totalSegments = segments.length;
        const totalLegs = legs.length;
        let layoverCount = totalSegments - totalLegs;
        let layoverLabel = '';
        if (layoverCount > 0) {
            layoverLabel = `<span class="layover-chip">${layoverCount} stop${layoverCount > 1 ? 's' : ''}</span>`;
        }

        // Trip type display
        const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);

        const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';
        const statusBadge = t.status === 'matched'
            ? '<span class="match-badge matched">✅ Matched</span>'
            : '<span class="match-badge unmatched">Unmatched</span>';

        // Calculate actual total for display on card
        let calculatedTotal = 0;
        const globalMarkup = parseFloat(journey.global_markup) || 0;

        passengers.forEach(p => {
            const f = p.fare || {};
            calculatedTotal += (parseFloat(f.base_fare) || 0) +
                (parseFloat(f.k3_gst) || 0) +
                (parseFloat(f.other_taxes) || 0) +
                globalMarkup;
        });

        // Use override if present, otherwise use calculated total
        const displayTotal = (t.grand_total && parseFloat(t.grand_total) > 0) ? parseFloat(t.grand_total) : calculatedTotal;

        return `<div class="itin-card" onclick="openTicket('${t.id}')">
            <div class="itin-card-top ${statusClass}"></div>
            <div class="itin-card-body">
                <div class="itin-card-header">
                    <div>
                        <div class="ticket-card-airline">
                            <span class="airline-tag">${safe(airline, 'Airline')}</span>
                            <span>${safe(flightNum)}</span>
                        </div>
                        <div class="ticket-card-route">
                            ${routeHtml}
                            ${layoverLabel}
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                        <span class="pnr-label">${safe(t.pnr, '---')}</span>
                        ${statusBadge}
                    </div>
                </div>
                <div class="itin-card-meta">
                    <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                    <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
                    ${t.class_of_travel && t.class_of_travel !== 'None' ? `<span class="meta-item"><b>Class:</b> ${safe(t.class_of_travel, 'Economy')}</span>` : ''}
                </div>
                <div class="ticket-card-pax">
                    ${passengers.map(p => `<span class="pax-chip">👤 ${safe(p.name, 'Passenger')}</span>`).join('')}
                </div>
                <div class="itin-card-footer">
                    <span class="itin-amount">${formatCurrency(displayTotal, t.currency || 'INR')}</span>
                    <span class="itin-date">${formatDate(t.created_at)}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==================== OPEN TICKET DETAIL ====================
async function openTicket(id) {
    try {
        const r = await fetch('/api/tickets/' + id);
        if (!r.ok) { showToast('Failed to load ticket', 'error'); return; }
        currentTicket = await r.json();
        editedData = JSON.parse(JSON.stringify(currentTicket));
        renderDetailView();
        document.getElementById('listView').style.display = 'none';
        document.getElementById('detailView').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { console.error(e); showToast('Error loading ticket', 'error'); }
}

function showListView() {
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('listView').style.display = 'block';
    currentTicket = null;
    editedData = {};
    loadTickets();
}

// ==================== RENDER DETAIL ====================
function renderDetailView() {
    const t = editedData;
    if (!t) return;
    const segments = t.segments || [];
    const journey = t.journey || {};

    // Use journey legs if available
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    const firstLegIndices = legs[0] || [];
    const lastLegIndices = legs[legs.length - 1] || [];
    const firstSeg = segments[firstLegIndices[0]] || segments[0] || {};
    let arrCode = '';
    if (t.trip_type === 'round_trip' && legs.length >= 2) {
        const outboundLastSeg = segments[legs[0][legs[0].length - 1]] || {};
        arrCode = (outboundLastSeg.arrival || {}).airport || '';
    } else {
        const lastSeg = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
        arrCode = (lastSeg.arrival || {}).airport || '';
    }
    const depCode = (firstSeg.departure || {}).airport || '';

    const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);

    let headerRouteHtml = '';
    if (t.trip_type === 'multi_city') {
        const dests = [];
        legs.forEach(l => {
            const fs = segments[l[0]] || {};
            const apt = (fs.departure || {}).airport;
            if (apt) dests.push(apt);
        });
        const lastL = legs[legs.length - 1] || [];
        const ls = segments[lastL[lastL.length - 1] || 0] || segments[segments.length - 1] || {};
        const finalApt = (ls.arrival || {}).airport;
        if (finalApt) dests.push(finalApt);
        headerRouteHtml = dests.filter(Boolean).join(' → ');
    } else {
        headerRouteHtml = `${depCode} ${t.trip_type === 'round_trip' ? '↔' : '→'} ${arrCode}`;
    }

    document.getElementById('ticketDetailHeader').innerHTML = `
        <div>
            <h1>${headerRouteHtml}</h1>
            <div class="detail-subtitle">
                <span class="pnr-label" style="font-size:0.9rem;">${safe(t.pnr, 'No PNR')}</span>
                &nbsp;${t.status === 'matched' ? '<span class="match-badge matched">✅ Matched</span>' : '<span class="match-badge unmatched">Unmatched</span>'}
                &nbsp;•&nbsp; ${tripDisplay}
            </div>
        </div>
        <div class="detail-actions">
            <button class="btn-action small danger" onclick="deleteTicket()">🗑️ Delete</button>
        </div>`;
    renderBookingSection();
    renderSegmentsSection();
    renderPassengersSection();
    renderFareSection();
    renderActionsSection();
}

function renderBookingSection() {
    const t = editedData;
    if (!t.raw_data) t.raw_data = {};
    if (!t.raw_data.gst_details) t.raw_data.gst_details = {};
    const gst = t.raw_data.gst_details;

    const gstHtml = `
        <div style="margin-top:1rem; padding:1rem; background:var(--bg-main); border-radius:10px; border:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
                <span style="font-size:1rem;">🏢</span>
                <span style="font-weight:700; font-size:0.9rem; color:var(--text-primary);">GST Details</span>
            </div>
            <div class="field-grid">
                <div class="field-item">
                    <label>Company Name</label>
                    <input type="text" value="${safe(gst.company_name)}" placeholder="Enter company name" onchange="editedData.raw_data.gst_details.company_name=this.value">
                </div>
                <div class="field-item">
                    <label>GSTIN</label>
                    <input type="text" value="${safe(gst.gst_number)}" placeholder="Enter full GST number" style="font-family:monospace;" onchange="editedData.raw_data.gst_details.gst_number=this.value">
                </div>
            </div>
        </div>`;

    document.getElementById('bookingSection').innerHTML = `
        <div class="section-header-row"><h2>📋 Booking Information</h2></div>
        <div class="field-grid">
            <div class="field-item"><label>PNR</label><input type="text" value="${safe(t.pnr)}" onchange="editedData.pnr=this.value"></div>
            <div class="field-item"><label>Booking Date</label><input type="text" value="${safe(t.booking_date)}" onchange="editedData.booking_date=this.value"></div>
            <div class="field-item"><label>Phone</label><input type="text" value="${safe(t.phone)}" onchange="editedData.phone=this.value"></div>
            <div class="field-item"><label>Currency</label><input type="text" value="${safe(t.currency, 'INR')}" onchange="editedData.currency=this.value"></div>
            <div class="field-item"><label>Class of Travel</label>
                <select onchange="editedData.class_of_travel=this.value">
                    <option value="None" ${!t.class_of_travel || t.class_of_travel === 'None' ? 'selected' : ''}>None (Mixed / Hidden)</option>
                    <option value="Economy" ${t.class_of_travel === 'Economy' ? 'selected' : ''}>Economy</option>
                    <option value="Premium Economy" ${t.class_of_travel === 'Premium Economy' ? 'selected' : ''}>Premium Economy</option>
                    <option value="Business" ${t.class_of_travel === 'Business' ? 'selected' : ''}>Business</option>
                    <option value="First" ${t.class_of_travel === 'First' ? 'selected' : ''}>First</option>
                </select></div>
            <div class="field-item"><label>Trip Type</label>
                <select onchange="editedData.trip_type=this.value; renderDetailView()">
                    <option value="one_way" ${t.trip_type === 'one_way' ? 'selected' : ''}>One Way</option>
                    <option value="round_trip" ${t.trip_type === 'round_trip' ? 'selected' : ''}>Round Trip</option>
                    <option value="multi_city" ${t.trip_type === 'multi_city' ? 'selected' : ''}>Multi-City</option>
                </select></div>
        </div>
        ${gstHtml}`;
}

function renderSegmentsSection() {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    const tripType = editedData.trip_type || 'one_way';

    // Use journey legs from API if available, otherwise fall back to grouping
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    // Build a lookup for layover info from journey data
    const layoverMap = {};
    if (journey.layovers && journey.layovers.length > 0) {
        journey.layovers.forEach(lo => {
            layoverMap[lo.after_segment] = lo;
        });
    }

    // Trip type display
    const tripDisplay = journey.trip_type_display || getTripLabel(tripType);
    const hasLayovers = journey.has_layovers || legs.some(l => l.length > 1);

    let html = `<div class="section-header-row">
        <h2>✈️ Flight Segments</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <span class="trip-type-chip">${tripDisplay}</span>
            <span class="badge">${legs.length} leg${legs.length > 1 ? 's' : ''} • ${segments.length} segment${segments.length > 1 ? 's' : ''}</span>
        </div>
    </div>`;

    legs.forEach((legIndices, legIdx) => {
        const legLabel = getLegLabel(legIdx, legs.length, tripType);
        const firstSeg = segments[legIndices[0]] || {};
        const lastSeg = segments[legIndices[legIndices.length - 1]] || {};
        const legOrigin = (firstSeg.departure || {}).airport || '---';
        const legOriginCity = (firstSeg.departure || {}).city || '';
        const legDest = (lastSeg.arrival || {}).airport || '---';
        const legDestCity = (lastSeg.arrival || {}).city || '';
        const hasStops = legIndices.length > 1;
        const stopCount = legIndices.length - 1;
        const depDate = (firstSeg.departure || {}).date || '';
        const depTime = (firstSeg.departure || {}).time || '';
        const arrTime = (lastSeg.arrival || {}).time || '';
        const arrDate = (lastSeg.arrival || {}).date || '';

        // Get total duration from journey leg data if available
        let legDuration = '';
        if (journey.legs && journey.legs[legIdx]) {
            legDuration = journey.legs[legIdx].total_duration || '';
        }

        // Collect layover airport codes for summary
        const layoverAirports = [];
        if (hasStops) {
            for (let k = 0; k < legIndices.length - 1; k++) {
                const segIdx = legIndices[k];
                const lo = layoverMap[segIdx];
                if (lo) {
                    layoverAirports.push(lo.at_airport);
                } else {
                    const seg = segments[segIdx];
                    layoverAirports.push((seg.arrival || {}).airport || '?');
                }
            }
        }

        const legId = `leg-${legIdx}`;
        const isCollapsible = hasStops;

        html += `<div class="leg-group-v2">
            <div class="leg-header-v2" ${isCollapsible ? `onclick="toggleLeg('${legId}')" style="cursor:pointer;"` : ''}>
                <div style="display:flex; width:100%; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
                    
                    <!-- Left: Badge -->
                    <div style="display:flex; align-items:center;">
                        <span class="leg-badge-v2">${legLabel}</span>
                    </div>

                    <!-- Middle: Visual Route + Duration -->
                    <div style="display:flex; flex:1; justify-content:center; align-items:center; gap:1.5rem; min-width:300px;">
                        <!-- Departure Info -->
                        <div style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="leg-code">${legOrigin}</span>
                                ${legOriginCity ? `<span class="leg-city" style="font-size:0.75rem; color:var(--text-secondary);">(${legOriginCity})</span>` : ''}
                            </div>
                            <div style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px;">
                                <span style="font-weight:700; font-size:0.95rem;">${depTime || '--:--'}</span>
                                <span style="font-size:0.7rem; color:var(--text-secondary);">${depDate}</span>
                            </div>
                        </div>

                        <!-- Arrow & Duration -->
                        <div style="flex:1; max-width:180px; position:relative; display:flex; flex-direction:column; align-items:center; min-height:40px; justify-content:center;">
                            ${legDuration ? `<div style="position:absolute; top:-12px; left:50%; transform:translateX(-50%); font-size:0.72rem; font-weight:600; color:var(--primary); padding:0.1rem 0.4rem; background:rgba(37,99,235,0.08); border-radius:6px; white-space:nowrap;">🕐 ${legDuration}</div>` : ''}
                            
                            <div style="width:100%; height:2px; background:linear-gradient(90deg, var(--primary), #8b5cf6); border-radius:2px; position:relative; margin: 4px 0;">
                                <div style="position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); font-size:0.95rem; color:#8b5cf6; background:transparent; z-index:1;">✈</div>
                            </div>
                            
                            <div style="position:absolute; top:24px; left:50%; transform:translateX(-50%); white-space:nowrap; display:flex; flex-direction:column; align-items:center;">
                                ${hasStops ? `<div style="font-size:0.65rem; color:#f59e0b; font-weight:600; text-align:center;">${stopCount} stop${stopCount > 1 ? 's' : ''} in ${layoverAirports.join(', ')}</div>` : '<span class="leg-stops-badge direct" style="padding:0.15rem 0.5rem; font-size:0.65rem; font-weight:600;">Direct</span>'}
                            </div>
                        </div>

                        <!-- Arrival Info -->
                        <div style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="leg-code">${legDest}</span>
                                ${legDestCity ? `<span class="leg-city" style="font-size:0.75rem; color:var(--text-secondary);">(${legDestCity})</span>` : ''}
                            </div>
                            <div style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px;">
                                <span style="font-weight:700; font-size:0.95rem;">${arrTime || '--:--'}</span>
                                <span style="font-size:0.7rem; color:var(--text-secondary);">${arrDate}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Right: Toggle Icon -->
                    <div style="display:flex; align-items:center; min-width:20px; justify-content:flex-end;">
                        ${isCollapsible ? '<span class="leg-expand-icon" id="icon-' + legId + '">▼</span>' : '<span style="width:12px;"></span>'}
                    </div>

                </div>
            </div>
            <div class="leg-segments-v2 ${isCollapsible ? 'collapsed' : ''}" id="${legId}">`;

        legIndices.forEach((segIdx, posInLeg) => {
            const seg = segments[segIdx];
            const dep = seg.departure || {};
            const arr = seg.arrival || {};
            let duration = '';
            if (seg.duration_calculated && seg.duration_calculated !== 'N/A') {
                duration = seg.duration_calculated;
            } else if (seg.duration_extracted && seg.duration_extracted !== 'N/A') {
                duration = seg.duration_extracted;
            }

            // Layover indicator between segments in same leg
            if (posInLeg > 0) {
                const lo = layoverMap[legIndices[posInLeg - 1]];
                const layoverDur = lo ? lo.duration : (seg.layover_duration || '');
                const layoverCity = lo ? lo.at_airport : (dep.city || dep.airport || '');
                html += `<div class="layover-indicator-v2">
                    <div class="layover-line-v2"></div>
                    <div class="layover-info-v2">
                        <span class="layover-icon-v2">⏱️</span>
                        <span class="layover-text">Layover${layoverDur && layoverDur !== 'N/A' ? ' <strong>' + layoverDur + '</strong>' : ''} at <strong>${layoverCity}</strong></span>
                    </div>
                    <div class="layover-line-v2"></div>
                </div>`;
            }

            let bkClassStr = '';
            const bc = seg.booking_class;
            if (typeof bc === 'object' && bc !== null) {
                bkClassStr = bc.full_form || bc.cabin || '';
            } else if (typeof bc === 'string' && bc.trim() !== '') {
                bkClassStr = bc.trim();
            }
            if (bkClassStr.toUpperCase() === 'N/A') {
                bkClassStr = '';
            }

            html += `<div class="segment-card-v2">
                <div class="segment-header-v2">
                    <div class="segment-airline-info">
                        <span class="segment-airline-v2">${safe(seg.airline, 'Airline')}</span>
                        <span class="segment-fltnum-v2">${safe(seg.flight_number)}</span>
                        ${bkClassStr ? `<span class="seg-class-chip">${bkClassStr}</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <button class="btn-action small secondary" onclick="editSegment(${segIdx})">✏️ Edit</button>
                    </div>
                </div>
                <div class="segment-timeline-v2">
                    <div class="timeline-point dep">
                        <div class="timeline-dot"></div>
                        <div class="timeline-details" style="display:flex; flex-direction:column; align-items:flex-start;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="tl-code">${safe(dep.airport, '---')}</span>
                                ${dep.city ? `<span class="tl-city" style="font-size:0.75rem; color:var(--text-secondary);">(${safe(dep.city)})</span>` : ''}
                            </div>
                            <div class="tl-datetime" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start;">
                                <span class="tl-time">${safe(dep.time, '--:--')}</span>
                                <span class="tl-date">${safe(dep.date)}</span>
                            </div>
                            ${dep.terminal && dep.terminal !== 'N/A' ? `<span class="tl-terminal">Terminal ${dep.terminal}</span>` : ''}
                        </div>
                    </div>
                    <div class="timeline-connector">
                        ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                    </div>
                    <div class="timeline-point arr">
                        <div class="timeline-dot arr-dot"></div>
                        <div class="timeline-details" style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="tl-code">${safe(arr.airport, '---')}</span>
                                ${arr.city ? `<span class="tl-city" style="font-size:0.75rem; color:var(--text-secondary);">(${safe(arr.city)})</span>` : ''}
                            </div>
                            <div class="tl-datetime" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start;">
                                <span class="tl-time">${safe(arr.time, '--:--')}</span>
                                <span class="tl-date">${safe(arr.date)}</span>
                            </div>
                            ${arr.terminal && arr.terminal !== 'N/A' ? `<span class="tl-terminal">Terminal ${arr.terminal}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        });

        html += `</div></div>`;
    });

    document.getElementById('segmentsSection').innerHTML = html;
}

function toggleLeg(legId) {
    const el = document.getElementById(legId);
    const icon = document.getElementById('icon-' + legId);
    if (!el) return;
    el.classList.toggle('collapsed');
    if (icon) icon.textContent = el.classList.contains('collapsed') ? '▼' : '▲';
}

function renderPassengersSection() {
    const passengers = editedData.passengers || [];
    const segments = editedData.segments || [];
    const legs = groupSegmentsIntoLegs(segments);
    const tripType = editedData.trip_type || 'one_way';
    const hasMultipleSegments = segments.length > 1;

    let html = `<div class="section-header-row">
        <h2>👥 Passengers</h2>
        <button class="btn-action small primary" onclick="addPassenger()">+ Add Passenger</button>
    </div>`;

    passengers.forEach((p, i) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        const typeClass = paxType.toLowerCase();
        const seats = p.seats || [];

        html += `<div class="pax-edit-card">
            <div class="pax-edit-header">
                <h4>👤 ${safe(p.name, 'Passenger ' + (i + 1))}</h4>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span class="pax-type-badge ${typeClass}">${paxType}</span>
                    <button class="btn-action small danger" onclick="removePassenger(${i})" style="padding:0.3rem 0.5rem;">✕</button>
                </div>
            </div>
            <div class="field-grid">
                <div class="field-item"><label>Name</label><input type="text" value="${safe(p.name)}" onchange="editedData.passengers[${i}].name=this.value"></div>
                <div class="field-item"><label>Pax Type</label>
                    <select onchange="editedData.passengers[${i}].pax_type=this.value">
                        <option value="ADT" ${(p.pax_type || '').toUpperCase() === 'ADT' ? 'selected' : ''}>Adult</option>
                        <option value="CHD" ${(p.pax_type || '').toUpperCase() === 'CHD' ? 'selected' : ''}>Child</option>
                        <option value="INF" ${(p.pax_type || '').toUpperCase() === 'INF' ? 'selected' : ''}>Infant</option>
                    </select></div>
                <div class="field-item"><label>Ticket Number</label><input type="text" value="${safe(p.ticket_number)}" onchange="editedData.passengers[${i}].ticket_number=this.value"></div>
                <div class="field-item"><label>Frequent Flyer</label><input type="text" value="${safe(p.frequent_flyer_number)}" onchange="editedData.passengers[${i}].frequent_flyer_number=this.value"></div>
                <div class="field-item"><label>Baggage</label><input type="text" value="${safe(p.baggage)}" onchange="editedData.passengers[${i}].baggage=this.value"></div>
                <div class="field-item"><label>Meal</label><input type="text" value="${safe(p.meal)}" onchange="editedData.passengers[${i}].meal=this.value"></div>
            </div>`;

        // Section-wise seat assignment
        if (hasMultipleSegments) {
            html += `<div class="seat-section-title">Seat Assignments by Segment</div>
            <div class="seat-grid">`;
            legs.forEach((legIndices, legIdx) => {
                const legLabel = getLegLabel(legIdx, legs.length, tripType);
                legIndices.forEach((segIdx) => {
                    const seg = segments[segIdx];
                    const dep = (seg.departure || {}).airport || '?';
                    const arr = (seg.arrival || {}).airport || '?';
                    // Find seat for this segment
                    const seatObj = seats.find(s => s.segment_index === segIdx) || {};
                    const seatNum = seatObj.seat_number || '';
                    html += `<div class="field-item seat-field">
                        <label>${dep} → ${arr}</label>
                        <input type="text" placeholder="e.g. 12A" value="${safe(seatNum)}" onchange="updateSeatForSegment(${i}, ${segIdx}, this.value)">
                    </div>`;
                });
            });
            html += `</div>`;
        } else {
            const seatNum = seats.length > 0 ? (seats[0].seat_number || (typeof seats[0] === 'string' ? seats[0] : '')) : '';
            html += `<div class="seat-section-title">Seat Assignment</div>
            <div class="seat-grid">
                <div class="field-item seat-field">
                    <label>Seat</label>
                    <input type="text" placeholder="e.g. 12A" value="${safe(typeof seatNum === 'object' ? seatNum.seat_number : seatNum)}" onchange="updateSeatForSegment(${i}, 0, this.value)">
                </div>
            </div>`;
        }

        // Ancillary Services Assignment
        const getAncHTML = (paxIdx, segIdx, dep, arr) => {
            let aHtml = `<div style="margin-top: 1.5rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">${dep} ${arr ? '→ ' + arr : ''} Ancillaries</label>
                <button class="btn-action small success" onclick="addAncillary(${paxIdx}, ${segIdx})" style="padding: 2px 8px; font-size: 11px;">+ Add Service</button>
            </div><div class="seat-grid" style="margin-bottom: 0.5rem;">`;
            const ancs = p.ancillaries || [];
            let found = 0;
            ancs.forEach((anc, globalAncIdx) => {
                if (anc.segment_index === segIdx) {
                    found++;
                    aHtml += `<div class="field-item" style="display:flex; flex-direction:row; align-items:center; gap:6px; margin: 0;">
                        <input type="text" placeholder="Service" value="${safe(anc.name)}" onchange="updateAncillaryForSegment(${paxIdx}, ${globalAncIdx}, this.value)" style="flex:1; min-width: 0; font-size: 0.85rem; padding: 0.4rem 0.6rem;">
                        <button class="btn-action small danger" onclick="removeAncillary(${paxIdx}, ${globalAncIdx})" style="flex: 0 0 28px; height: 28px; padding: 0; display:flex; align-items:center; justify-content:center; font-size: 12px; border-radius: 6px;">✕</button>
                    </div>`;
                }
            });
            if (found === 0) {
                aHtml += `<div style="grid-column: 1/-1; font-size: 0.85rem; color: #999; padding-bottom: 0.5rem;">No ancillary services.</div>`;
            }
            aHtml += `</div>`;
            return aHtml;
        };

        if (hasMultipleSegments) {
            legs.forEach((legIndices) => {
                legIndices.forEach((segIdx) => {
                    const seg = segments[segIdx];
                    const dep = (seg.departure || {}).airport || '?';
                    const arr = (seg.arrival || {}).airport || '?';
                    html += getAncHTML(i, segIdx, dep, arr);
                });
            });
        } else {
            html += getAncHTML(i, 0, "Flight", "");
        }

        html += `</div>`;
    });

    html += `<button class="add-pax-btn" onclick="addPassenger()">+ Add New Passenger</button>`;
    document.getElementById('passengersSection').innerHTML = html;
}

function renderFareSection() {
    const passengers = editedData.passengers || [];
    const curr = editedData.currency || 'INR';
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.fare_display) {
        editedData.journey.fare_display = passengers.length <= 1 ? 'per_passenger' : 'consolidated';
    }
    const isConsolidated = editedData.journey.fare_display === 'consolidated';
    const globalMarkup = parseFloat(editedData.journey.global_markup) || 0;

    let html = `<div class="section-header-row">
        <h2>💰 Fare Details</h2>
        <button class="btn-action small secondary" onclick="editedData.journey.fare_display = '${isConsolidated ? 'per_passenger' : 'consolidated'}'; renderFareSection();">
            🔄 Show ${isConsolidated ? 'Per Passenger' : 'Consolidated'}
        </button>
    </div>`;

    if (isConsolidated) {
        if (!editedData.journey.consolidated_fare) {
            let totalBase = 0, totalK3 = 0, totalOther = 0;
            passengers.forEach(p => {
                const f = p.fare || {};
                totalBase += parseFloat(f.base_fare) || 0;
                totalK3 += parseFloat(f.k3_gst) || 0;
                totalOther += parseFloat(f.other_taxes) || 0;
            });
            editedData.journey.consolidated_fare = { base_fare: totalBase, k3_gst: totalK3, other_taxes: totalOther };
        }
        const cf = editedData.journey.consolidated_fare;
        const base = parseFloat(cf.base_fare) || 0;
        const k3 = parseFloat(cf.k3_gst) || 0;
        const other = parseFloat(cf.other_taxes) || 0;
        const displayOther = other + (globalMarkup * passengers.length);
        const total = base + k3 + displayOther;

        html += `<table class="fare-table">
            <thead><tr>
                <th>Total Passengers</th><th>Total Base Fare</th>
                <th>Total Airline GST (K3)</th><th>Total Other Taxes & Fees</th>
                <th>Total Fare</th>
            </tr></thead><tbody>
            <tr>
                <td>${passengers.length}</td>
                <td><input type="number" value="${base}" onchange="editedData.journey.consolidated_fare.base_fare=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td><input type="number" value="${k3}" onchange="editedData.journey.consolidated_fare.k3_gst=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td><input type="number" id="cons-other" value="${displayOther}" onchange="editedData.journey.consolidated_fare.other_taxes=(parseFloat(this.value)||0)-((parseFloat(editedData.journey.global_markup)||0)*${passengers.length}); recalcFareGlobal()"></td>
                <td><strong id="cons-total">${formatCurrency(total, curr)}</strong></td>
            </tr>
            </tbody></table>`;
    } else {
        html += `<table class="fare-table">
            <thead><tr>
                <th>Sr</th><th>Passenger</th><th>Base Fare</th>
                <th>Airline GST (K3)</th><th>Other Taxes & Fees</th>
                <th>Total Fare</th>
            </tr></thead><tbody>`;

        passengers.forEach((p, i) => {
            const fare = p.fare || {};
            const paxType = getPaxLabel(p.pax_type || p.type);
            const base = parseFloat(fare.base_fare) || 0;
            const k3 = parseFloat(fare.k3_gst) || 0;
            const other = parseFloat(fare.other_taxes) || 0;
            const displayOther = other + globalMarkup;
            const total = base + k3 + displayOther;

            if (!fare.total_fare || parseFloat(fare.total_fare) !== total) {
                if (!editedData.passengers[i].fare) editedData.passengers[i].fare = {};
                editedData.passengers[i].fare.total_fare = total;
            }

            html += `<tr>
                <td>${i + 1}</td>
                <td><strong>${safe(p.name, paxType)}</strong><br><small style="color:var(--text-secondary)">${paxType}</small></td>
                <td><input type="number" value="${base}" onchange="editedData.passengers[${i}].fare.base_fare=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td><input type="number" value="${k3}" onchange="editedData.passengers[${i}].fare.k3_gst=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td><input type="number" id="pax-other-${i}" value="${displayOther}" onchange="editedData.passengers[${i}].fare.other_taxes=(parseFloat(this.value)||0)-(parseFloat(editedData.journey.global_markup)||0); recalcFareGlobal()"></td>
                <td><strong id="pax-total-${i}">${formatCurrency(total, curr)}</strong></td>
            </tr>`;
        });

        html += `</tbody></table>`;
    }

    recalcFareGlobal(false);

    html += `<div style="margin-top:1.5rem; display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="field-item">
            <label style="color:var(--primary);font-weight:700;">Global Markup <small>(per passenger)</small></label>
            <input type="number" value="${globalMarkup}" onchange="editedData.journey.global_markup=parseFloat(this.value)||0; recalcFareGlobal()">
        </div>
        <div class="field-item">
            <label>Override Grand Total</label>
            <input type="number" id="override-grand-total" value="${editedData.grand_total}" onchange="editedData.grand_total=parseFloat(this.value)||0; document.getElementById('grand-total-val').textContent=formatCurrency(this.value, '${curr}')">
        </div>
        <div style="flex:1; display:flex; justify-content:flex-end; font-size:1.15rem; font-weight:700;">
            Grand Total : &nbsp;<span id="grand-total-val" style="color:var(--primary);">${formatCurrency(editedData.grand_total, curr)}</span>
        </div>
    </div>`;

    document.getElementById('fareSection').innerHTML = html;
}

function renderActionsSection() {
    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
        <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
            <div class="pdf-btn-group">
                <button class="pdf-btn with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                <button class="pdf-btn without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
            </div>
        </div>`;
}

// ==================== EDIT HELPERS ====================
function recalcFareGlobal(redraw = true) {
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.fare_display) {
        editedData.journey.fare_display = (editedData.passengers || []).length <= 1 ? 'per_passenger' : 'consolidated';
    }
    const isConsolidated = editedData.journey.fare_display === 'consolidated';
    const globalMarkup = parseFloat(editedData.journey.global_markup) || 0;
    let gt = 0;

    if (isConsolidated) {
        const cf = editedData.journey.consolidated_fare || {};
        const passengersCount = (editedData.passengers || []).length;
        const displayOther = (parseFloat(cf.other_taxes) || 0) + (globalMarkup * passengersCount);
        const total = (parseFloat(cf.base_fare) || 0) + (parseFloat(cf.k3_gst) || 0) + displayOther;
        gt = total;

        const otherEl = document.getElementById('cons-other');
        if (otherEl && redraw) otherEl.value = displayOther;
        const ct = document.getElementById('cons-total');
        if (ct && redraw) ct.textContent = formatCurrency(total, editedData.currency || 'INR');
    } else {
        editedData.passengers.forEach((p, i) => {
            const f = p.fare || {};
            const base = parseFloat(f.base_fare) || 0;
            const k3 = parseFloat(f.k3_gst) || 0;
            const other = parseFloat(f.other_taxes) || 0;
            const displayOther = other + globalMarkup;
            const total = base + k3 + displayOther;
            f.total_fare = total;
            gt += total;

            const otherEl = document.getElementById('pax-other-' + i);
            if (otherEl && redraw) otherEl.value = displayOther;
            const pt = document.getElementById('pax-total-' + i);
            if (pt && redraw) pt.textContent = formatCurrency(total, editedData.currency || 'INR');
        });
    }

    editedData.grand_total = gt;
    const curr = editedData.currency || 'INR';

    if (redraw) {
        const overrideEl = document.getElementById('override-grand-total');
        if (overrideEl) overrideEl.value = gt;
        const gtEl = document.getElementById('grand-total-val');
        if (gtEl) gtEl.textContent = formatCurrency(gt, curr);
    }
}

function addPassenger() {
    if (!editedData.passengers) editedData.passengers = [];
    const segments = editedData.segments || [];
    const seatEntries = segments.map((_, idx) => ({ segment_index: idx, seat_number: '' }));
    editedData.passengers.push({
        name: '', pax_type: 'ADT', ticket_number: '',
        frequent_flyer_number: '', baggage: '', meal: '',
        ancillaries: [], seats: seatEntries,
        fare: { base_fare: 0, k3_gst: 0, other_taxes: 0, total_fare: 0 }
    });
    renderPassengersSection();
    renderFareSection();
    triggerAutoSave();
    showToast('New passenger added', 'info');
}

function removePassenger(idx) {
    if (!confirm('Remove this passenger?')) return;
    editedData.passengers.splice(idx, 1);
    renderPassengersSection();
    renderFareSection();
    triggerAutoSave();
    showToast('Passenger removed', 'info');
}

function updateSeatForSegment(paxIdx, segIdx, value) {
    if (!editedData.passengers[paxIdx].seats) editedData.passengers[paxIdx].seats = [];
    const seats = editedData.passengers[paxIdx].seats;
    const existing = seats.findIndex(s => s.segment_index === segIdx);
    if (existing >= 0) {
        seats[existing].seat_number = value;
    } else {
        seats.push({ segment_index: segIdx, seat_number: value });
    }
}

function updateAncillaryForSegment(paxIdx, ancIdx, value) {
    if (editedData.passengers[paxIdx] && editedData.passengers[paxIdx].ancillaries) {
        editedData.passengers[paxIdx].ancillaries[ancIdx].name = value;
        editedData.passengers[paxIdx].ancillaries[ancIdx].code = value;
    }
}

function addAncillary(paxIdx, segIdx) {
    if (!editedData.passengers[paxIdx].ancillaries) editedData.passengers[paxIdx].ancillaries = [];
    editedData.passengers[paxIdx].ancillaries.push({ segment_index: segIdx, name: '', code: '' });
    renderPassengersSection();
}

function removeAncillary(paxIdx, ancIdx) {
    if (editedData.passengers[paxIdx] && editedData.passengers[paxIdx].ancillaries) {
        editedData.passengers[paxIdx].ancillaries.splice(ancIdx, 1);
        renderPassengersSection();
    }
}

function editSegment(idx) {
    const seg = editedData.segments[idx];
    const dep = seg.departure || {};
    const arr = seg.arrival || {};
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div id="segment-edit-modal-content" style="background:var(--bg-card);border-radius:16px;padding:2rem;max-width:750px;width:95%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0,0,0,0.3);" onclick="event.stopPropagation()">
            <h3 style="margin-top:0;">✏️ Edit Segment ${idx + 1}</h3>
            
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border);">
                <div class="field-item"><label>Airline</label><input type="text" id="seg-airline" value="${safe(seg.airline)}"></div>
                <div class="field-item"><label>Flight Number</label><input type="text" id="seg-fltnum" value="${safe(seg.flight_number)}"></div>
                <div class="field-item"><label>Booking Class</label><input type="text" id="seg-class" value="${safe(seg.booking_class)}"></div>
                <div class="field-item" style="grid-column: 1 / -1;"><label>Duration</label><input type="text" id="seg-duration" value="${safe(seg.duration_extracted || seg.duration_calculated)}"></div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 0.5rem;">
                <!-- Departure Column -->
                <div style="background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px dashed rgba(37,99,235,0.4);">
                    <h4 style="margin-top:0; color: var(--primary); display:flex; align-items:center; gap:0.5rem;">🛫 Departure</h4>
                    <div class="field-grid" style="grid-template-columns: 1fr;">
                        <div class="field-item"><label>Airport Code</label><input type="text" id="seg-dep-apt" value="${safe(dep.airport)}" style="font-family: monospace; font-size:1rem; font-weight:bold;"></div>
                        <div class="field-item"><label>City</label><input type="text" id="seg-dep-city" value="${safe(dep.city)}"></div>
                        <div class="field-item"><label>Date</label><input type="text" id="seg-dep-date" value="${safe(dep.date)}"></div>
                        <div class="field-item"><label>Time</label><input type="text" id="seg-dep-time" value="${safe(dep.time)}"></div>
                        <div class="field-item"><label>Terminal</label><input type="text" id="seg-dep-term" value="${safe(dep.terminal)}"></div>
                    </div>
                </div>

                <!-- Arrival Column -->
                <div style="background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px dashed rgba(16,185,129,0.4);">
                    <h4 style="margin-top:0; color: var(--success); display:flex; align-items:center; gap:0.5rem;">🛬 Arrival</h4>
                    <div class="field-grid" style="grid-template-columns: 1fr;">
                        <div class="field-item"><label>Airport Code</label><input type="text" id="seg-arr-apt" value="${safe(arr.airport)}" style="font-family: monospace; font-size:1rem; font-weight:bold;"></div>
                        <div class="field-item"><label>City</label><input type="text" id="seg-arr-city" value="${safe(arr.city)}"></div>
                        <div class="field-item"><label>Date</label><input type="text" id="seg-arr-date" value="${safe(arr.date)}"></div>
                        <div class="field-item"><label>Time</label><input type="text" id="seg-arr-time" value="${safe(arr.time)}"></div>
                        <div class="field-item"><label>Terminal</label><input type="text" id="seg-arr-term" value="${safe(arr.terminal)}"></div>
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:1rem;justify-content:flex-end;margin-top:1.5rem;">
                <button class="btn-action secondary" onclick="this.closest('div[style*=position]').remove()">Cancel</button>
                <button class="btn-action primary" onclick="saveSegmentEdit(${idx})">Save Segment</button>
            </div>
        </div>`;
    modal.onclick = () => modal.remove();
    modal.id = 'segment-edit-modal';
    document.body.appendChild(modal);
}

function saveSegmentEdit(idx) {
    const seg = editedData.segments[idx];
    seg.airline = document.getElementById('seg-airline').value;
    seg.flight_number = document.getElementById('seg-fltnum').value;
    seg.booking_class = document.getElementById('seg-class').value;
    if (!seg.departure) seg.departure = {};
    seg.departure.airport = document.getElementById('seg-dep-apt').value;
    seg.departure.city = document.getElementById('seg-dep-city').value;
    seg.departure.date = document.getElementById('seg-dep-date').value;
    seg.departure.time = document.getElementById('seg-dep-time').value;
    seg.departure.terminal = document.getElementById('seg-dep-term').value;
    if (!seg.arrival) seg.arrival = {};
    seg.arrival.airport = document.getElementById('seg-arr-apt').value;
    seg.arrival.city = document.getElementById('seg-arr-city').value;
    seg.arrival.date = document.getElementById('seg-arr-date').value;
    seg.arrival.time = document.getElementById('seg-arr-time').value;
    seg.arrival.terminal = document.getElementById('seg-arr-term').value;
    seg.duration_extracted = document.getElementById('seg-duration').value;

    const modal = document.getElementById('segment-edit-modal');
    if (modal) modal.remove();

    renderSegmentsSection();
    triggerAutoSave();
    showToast('Segment updated', 'success');
}

// ==================== SAVE & PDF ====================
async function saveTicket(silent = false) {
    if (!currentTicket || !editedData) return;
    try {
        const payload = {
            pnr: editedData.pnr,
            booking_date: editedData.booking_date,
            phone: editedData.phone,
            currency: editedData.currency,
            grand_total: editedData.grand_total,
            class_of_travel: editedData.class_of_travel,
            trip_type: editedData.trip_type,
            passengers: editedData.passengers,
            segments: editedData.segments,
            journey: editedData.journey,
            raw_data: editedData.raw_data,
            status: editedData.status || 'unmatched'
        };
        const r = await fetch('/api/tickets/' + currentTicket.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!r.ok) {
            const e = await r.json();
            if (!silent) showToast(e.error || 'Save failed', 'error');
            return;
        }
        if (!silent) showToast('Ticket saved successfully!', 'success');

        const idx = allTickets.findIndex(t => t.id === currentTicket.id);
        if (idx > -1) {
            allTickets[idx] = JSON.parse(JSON.stringify(editedData));
            renderTicketCards();
        }
    } catch (e) {
        console.error(e);
        if (!silent) showToast('Save failed', 'error');
    }
}

let autoSaveTimeout = null;
function triggerAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        saveTicket(true); // silent auto-save
    }, 800);
}

async function downloadPDF(includeFare) {
    if (document.activeElement) document.activeElement.blur();
    try {
        await saveTicket();
        const url = `/api/tickets/${currentTicket.id}/pdf?include_fare=${includeFare}`;
        const a = document.createElement('a');
        a.href = url; a.download = '';
        document.body.appendChild(a); a.click(); a.remove();
        showToast(`PDF download started (${includeFare ? 'with fare' : 'without fare'})`, 'success');
    } catch (e) { showToast('PDF generation failed', 'error'); }
}

async function deleteTicket() {
    if (!confirm('Are you sure you want to delete this ticket?')) return;
    try {
        const r = await fetch('/api/tickets/' + currentTicket.id, { method: 'DELETE' });
        if (!r.ok) { showToast('Delete failed', 'error'); return; }
        showToast('Ticket deleted', 'success');
        showListView();
    } catch (e) { showToast('Delete failed', 'error'); }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    initializeSidebar();
    await checkAuth();
    await loadTickets();

    const detailView = document.getElementById('detailView');
    if (detailView) {
        detailView.addEventListener('change', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                triggerAutoSave();
            }
        });
    }
});
