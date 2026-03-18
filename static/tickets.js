// ==================== STATE ====================
let allTickets = [];
let currentTicket = null;
let currentFilter = 'all';
let editedData = {};
let changeAttachmentState = { token: '', filename: '' };

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

        // Ticket status badge (live/cancelled/changed)
        const tStatus = t.ticket_status || 'live';
        const tStatusBadge = tStatus === 'cancelled'
            ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">🔴 Cancelled</span>'
            : tStatus === 'changed'
            ? '<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">🟡 Changed</span>'
            : '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">🟢 Live</span>';
        const splitBadge = t.parent_ticket_id
            ? '<span style="background:rgba(15,23,42,0.08);color:var(--text-secondary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Split Booking</span>'
            : (t.children && t.children.length ? '<span style="background:rgba(37,99,235,0.08);color:var(--primary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Has Splits</span>' : '');
        const mergedBadge = t.booking_group_id
            ? '<span style="background:rgba(5,150,105,0.12);color:#059669;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Merged Booking</span>'
            : '';

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
                        ${tStatusBadge}
                        ${splitBadge}
                        ${mergedBadge}
                    </div>
                </div>
                <div class="itin-card-meta">
                    <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                    <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
                    ${t.class_of_travel && t.class_of_travel !== 'None' ? `<span class="meta-item"><b>Class:</b> ${safe(t.class_of_travel, 'Economy')}</span>` : ''}
                </div>
                <div class="ticket-card-pax">
                    ${passengers.map(p => `<span class="pax-chip">👤 ${safe(p.name, 'Passenger')}<br><span style="font-size:0.68rem;color:var(--text-secondary);">${safe(p.system_ticket_number, '')}</span></span>`).join('')}
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
    changeAttachmentState = { token: '', filename: '' };
    loadTickets();
}

async function openPnrMergeModal() {
    try {
        const r = await fetch('/api/tickets/pnr-groups');
        const data = await r.json();
        if (!r.ok) {
            showToast(data.error || 'Failed to load PNR groups', 'error');
            return;
        }
        const groups = data.groups || [];
        if (!groups.length) {
            showToast('No multi-passenger PNR groups detected right now', 'info');
            return;
        }

        const groupsHtml = groups.map(group => {
            const discrepancyCount = Object.keys(group.discrepancies || {}).length;
            const passengerBadge = group.has_different_passengers
                ? '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">Different passengers</span>'
                : '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">Same passenger</span>';
            return `<div style="padding:1rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-main);cursor:pointer;" onclick='openPnrGroupDetail(${JSON.stringify(group).replace(/"/g, '&quot;')})'>
                <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;flex-wrap:wrap;">
                    <div>
                        <div style="font-weight:800;font-size:1rem;">PNR ${group.pnr}</div>
                        <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.2rem;">${group.ticket_count} tickets detected</div>
                    </div>
                    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                        ${group.can_auto_merge
                            ? '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">Ready to merge</span>'
                            : `<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">${discrepancyCount} discrepancy fields</span>`}
                        ${passengerBadge}
                        ${group.merged_ticket_count ? `<span style="background:rgba(37,99,235,0.12);color:var(--primary);padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">${group.merged_ticket_count} already merged</span>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        const html = `<h3 style="margin-top:0;">PNR Booking Merge Detection</h3>
            <p style="color:var(--text-secondary);font-size:0.88rem;">Review detected passenger tickets that share the same PNR, inspect mismatches, and merge them under one booking object when safe.</p>
            <div style="display:grid;gap:0.85rem;max-height:60vh;overflow:auto;">${groupsHtml}</div>
            <div style="display:flex;justify-content:flex-end;margin-top:1.25rem;">
                <button class="btn-action secondary" onclick="_closeModal()">Close</button>
            </div>`;
        _createModalOverlay(html);
    } catch (e) {
        console.error(e);
        showToast('Failed to load PNR groups', 'error');
    }
}

function openPnrGroupDetail(group) {
    const compareFields = [
        ['airline', 'Airline'],
        ['route', 'Route'],
        ['flight_numbers', 'Flight Numbers'],
        ['departure_airport', 'Departure Airport'],
        ['arrival_airport', 'Arrival Airport'],
        ['departure_datetime', 'Departure Time'],
        ['arrival_datetime', 'Arrival Time']
    ];

    const discrepancyKeys = new Set(Object.keys(group.discrepancies || {}));
    const fieldSummaryHtml = compareFields.map(([key, label]) => {
        const mismatched = discrepancyKeys.has(key);
        return `<div style="padding:0.75rem;border-radius:12px;border:1px solid ${mismatched ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'};background:${mismatched ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.06)'};">
            <div style="font-size:0.76rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">${label}</div>
            <div style="margin-top:0.3rem;font-weight:700;color:${mismatched ? '#d97706' : '#059669'};">${mismatched ? 'Mismatch detected' : 'All tickets match'}</div>
        </div>`;
    }).join('');

    const ticketsHtml = (group.tickets || []).map(ticket => {
        const rows = compareFields.map(([key, label]) => {
            const mismatched = discrepancyKeys.has(key);
            return `<tr>
                <td style="padding:0.45rem 0.5rem;font-size:0.82rem;color:var(--text-secondary);">${label}</td>
                <td style="padding:0.45rem 0.5rem;font-size:0.82rem;font-weight:600;color:${mismatched ? '#d97706' : 'var(--text-primary)'};">${ticket[key] || '—'}</td>
            </tr>`;
        }).join('');
        return `<div style="padding:1rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-main);">
            <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:flex-start;">
                <div>
                    <div style="font-weight:800;">${(ticket.passenger_names || []).join(', ') || 'Passenger'}</div>
                    <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:0.2rem;">${(ticket.system_ticket_numbers || []).join(', ') || 'No system ID'} | Ticket ${ticket.ticket_id}</div>
                </div>
                ${ticket.booking_group_id ? '<span style="background:rgba(37,99,235,0.12);color:var(--primary);padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">Already linked</span>' : ''}
            </div>
            <table style="width:100%;margin-top:0.85rem;border-collapse:collapse;">${rows}</table>
        </div>`;
    }).join('');

    const warningHtml = group.can_auto_merge
        ? '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);color:#059669;font-weight:700;">All compared booking fields match. This group can be merged safely.</div>'
        : group.has_different_passengers
            ? '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);color:#b45309;font-weight:700;">Discrepancies were detected. Review carefully before forcing a merge.</div>'
            : '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:#b91c1c;font-weight:700;">These tickets appear to belong to the same passenger after ignoring title prefixes and letter case, so they should not be merged.</div>';

    const html = `<h3 style="margin-top:0;">PNR ${group.pnr}</h3>
        ${warningHtml}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-top:1rem;">${fieldSummaryHtml}</div>
        <div style="display:grid;gap:0.85rem;max-height:45vh;overflow:auto;margin-top:1rem;">${ticketsHtml}</div>
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.25rem;">
            <button class="btn-action secondary" onclick="openPnrMergeModal()">Back</button>
            ${group.has_different_passengers
                ? (group.can_auto_merge
                    ? `<button class="btn-action primary" onclick='mergePnrGroup("${group.pnr}", false, ${JSON.stringify(group.tickets.map(t => t.ticket_id)).replace(/"/g, '&quot;')})'>Merge Booking</button>`
                    : `<button class="btn-action primary" style="background:linear-gradient(135deg,#d97706,#f59e0b);" onclick='mergePnrGroup("${group.pnr}", true, ${JSON.stringify(group.tickets.map(t => t.ticket_id)).replace(/"/g, '&quot;')})'>Merge Anyway</button>`)
                : ''}
        </div>`;
    _createModalOverlay(html);
}

async function mergePnrGroup(pnr, forceMerge, ticketIds) {
    try {
        const r = await fetch(`/api/tickets/pnr-groups/${encodeURIComponent(pnr)}/merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force_merge: forceMerge, ticket_ids: ticketIds })
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || 'Merge failed', 'error');
            return;
        }
        showToast(result.message || 'Booking merged', 'success');
        _closeModal();
        await loadTickets();
    } catch (e) {
        console.error(e);
        showToast('Merge failed', 'error');
    }
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

    // Ticket status badge for detail
    const detailTStatus = t.ticket_status || 'live';
    const detailTStatusBadge = detailTStatus === 'cancelled'
        ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.2rem 0.7rem;border-radius:8px;font-size:0.82rem;font-weight:700;">🔴 Cancelled</span>'
        : detailTStatus === 'changed'
        ? '<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.2rem 0.7rem;border-radius:8px;font-size:0.82rem;font-weight:700;">🟡 Changed</span>'
        : '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.2rem 0.7rem;border-radius:8px;font-size:0.82rem;font-weight:700;">🟢 Live</span>';

    // Cancellation charge display
    const charge = parseFloat(t.cancellation_charge) || 0;
    const chargeHtml = charge > 0 ? `<span style="background:rgba(239,68,68,0.1); color:#dc2626; padding:0.2rem 0.6rem; border-radius:8px; font-size:0.8rem; font-weight:700; border:1px solid rgba(239,68,68,0.2);">⚠️ XXD: ₹${charge.toLocaleString('en-IN')}</span>` : '';

    document.getElementById('ticketDetailHeader').innerHTML = `
        <div>
            <h1>${headerRouteHtml}</h1>
            <div class="detail-subtitle">
                <span class="pnr-label" style="font-size:0.9rem;">${safe(t.pnr, 'No PNR')}</span>
                &nbsp;${t.status === 'matched' ? '<span class="match-badge matched">✅ Matched</span>' : '<span class="match-badge unmatched">Unmatched</span>'}
                &nbsp;${detailTStatusBadge}
                &nbsp;${chargeHtml}
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
    const cabinClassOptions = ['Economy', 'Premium Economy', 'Business', 'First'];

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

        html += `<div class="leg-group-v2" style="${(function() {
            const segs = legIndices.map(i => segments[i]);
            const isFullyCancelled = segs.every(s => s.status === 'cancelled');
            return isFullyCancelled ? 'border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.05);' : '';
        })()}">
            <div class="leg-header-v2" ${isCollapsible ? `onclick="toggleLeg('${legId}')" style="cursor:pointer;"` : ''}>
                <div style="display:flex; width:100%; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
                    
                    <!-- Left: Badge -->
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span class="leg-badge-v2">${legLabel}</span>
                        ${(function() {
                            const segs = legIndices.map(i => segments[i]);
                            const cancelled = segs.every(s => s.status === 'cancelled');
                            const partial = !cancelled && segs.some(s => s.status === 'cancelled');
                            if (cancelled) return '<span style="background:#ef4444; color:white; font-size:0.65rem; padding:1px 6px; border-radius:4px; font-weight:700;">CANCELLED</span>';
                            if (partial) return '<span style="background:#f59e0b; color:white; font-size:0.65rem; padding:1px 6px; border-radius:4px; font-weight:700;">PARTIAL CANCEL</span>';
                            return '';
                        })()}
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
            const showCabinClass = !!seg.show_booking_class && !!bkClassStr;
            const segmentCardClass = showCabinClass ? 'segment-card-v2 has-cabin-class' : 'segment-card-v2';
            const depDateTimeClass = showCabinClass ? 'tl-datetime has-cabin-class' : 'tl-datetime';
            const arrDateTimeClass = showCabinClass ? 'tl-datetime has-cabin-class' : 'tl-datetime';

            html += `<div class="${segmentCardClass}" style="${seg.status === 'cancelled' ? 'opacity:0.85; border-left:6px solid #ef4444; background:rgba(239,68,68,0.08); box-shadow: inset 0 0 10px rgba(239,68,68,0.1);' : ''}">
                <div class="segment-header-v2">
                    <div class="segment-airline-info">
                        <div class="segment-airline-main">
                            <span class="segment-airline-v2">${safe(seg.airline, 'Airline')}</span>
                            <span class="segment-fltnum-v2">${safe(seg.flight_number)}</span>
                        </div>
                        ${showCabinClass ? `<span class="seg-class-chip">${bkClassStr}</span>` : ''}
                        ${seg.status === 'cancelled' ? `
                            <span class="status-badge" style="background:#ef4444; color:white; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; box-shadow:0 2px 4px rgba(239,68,68,0.2);">🔴 CANCELLED</span>
                            ${editedData.cancellation_charge > 0 ? `<span style="background:rgba(239,68,68,0.08); color:#ef4444; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:10px; border:1px solid rgba(239,68,68,0.2);">Charge: ₹${editedData.cancellation_charge}</span>` : ''}
                        ` : ''}
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
                            <div class="${depDateTimeClass}" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start;">
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
                            <div class="${arrDateTimeClass}" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start;">
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
            </div>`;

        const getAncHTML = (paxIdx, segIdx) => {
            const ancs = p.ancillaries || [];
            const hasAnc = ancs.some(anc => anc.segment_index === segIdx);
            if (!hasAnc) return '';

            let aHtml = `<div style="margin-top: 0.5rem; display:flex; flex-direction:column; gap:0.5rem; border-top: 1px dashed var(--border); padding-top: 0.5rem;">`;
            ancs.forEach((anc, globalAncIdx) => {
                if (anc.segment_index === segIdx) {
                    aHtml += `<div style="display:flex; flex-direction:row; align-items:center; gap:0.5rem;">
                        <input type="text" placeholder="Ancillary Service (e.g. Wheelchair)" value="${safe(anc.name)}" onchange="updateAncillaryForSegment(${paxIdx}, ${globalAncIdx}, this.value)" style="flex:1;">
                        <button class="btn-action small danger" onclick="removeAncillary(${paxIdx}, ${globalAncIdx})" style="flex: 0 0 auto; padding: 0.4rem 0.8rem;">✕</button>
                    </div>`;
                }
            });
            aHtml += `</div>`;
            return aHtml;
        };

        const getBarcodeHTML = (segIdx) => {
            const seg = segments[segIdx] || {};
            if (!seg.barcode_image) return '';
            return `<div style="margin-top:0.75rem; border-top:1px dashed var(--border); padding-top:0.75rem;">
                <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Boarding Barcode</div>
                <img src="${seg.barcode_image}" alt="PDF417 barcode for segment ${segIdx + 1}" style="display:block; width:100%; max-width:280px; height:auto; background:#fff; border:1px solid var(--border); border-radius:10px; padding:0.35rem;">
            </div>`;
        };

        // Section-wise seat and meal assignment
        if (hasMultipleSegments) {
            html += `<div class="seat-section-title">Seat & Meal Assignments by Segment</div>
            <div class="seat-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">`;
            legs.forEach((legIndices, legIdx) => {
                const legLabel = getLegLabel(legIdx, legs.length, tripType);
                legIndices.forEach((segIdx) => {
                    const seg = segments[segIdx];
                    const dep = (seg.departure || {}).airport || '?';
                    const arr = (seg.arrival || {}).airport || '?';
                    // Find seat for this segment
                    const seatObj = seats.find(s => s.segment_index === segIdx) || {};
                    const seatNum = seatObj.seat_number || '';

                    // Find meal for this segment
                    const mealObj = (p.meals || []).find(m => m.segment_index === segIdx) || {};
                    const mealName = mealObj.name || mealObj.code || '';

                    html += `<div class="field-item seat-field" style="background:var(--bg-main); padding:0.5rem; border-radius:8px; border:1px solid var(--border);">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="color:var(--primary); font-weight:700; margin:0;">${dep} → ${arr}</label>
                            <button class="btn-action small success" onclick="addAncillary(${i}, ${segIdx})" style="padding: 2px 8px; font-size: 11px;">+ Service</button>
                        </div>
                        <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                            <input type="text" placeholder="Seat (e.g. 12A)" value="${safe(seatNum)}" onchange="updateSeatForSegment(${i}, ${segIdx}, this.value)" style="flex:1;">
                            <input type="text" placeholder="Meal (e.g. VGML)" value="${safe(mealName)}" onchange="updateMealForSegment(${i}, ${segIdx}, this.value)" style="flex:1;">
                        </div>
                        ${getAncHTML(i, segIdx)}
                        ${getBarcodeHTML(segIdx)}
                    </div>`;
                });
            });
            html += `</div>`;
        } else {
            const seatNum = seats.length > 0 ? (seats[0].seat_number || (typeof seats[0] === 'string' ? seats[0] : '')) : '';
            const mealObj = (p.meals || []).length > 0 ? (p.meals[0].name || p.meals[0].code || '') : (typeof p.meal === 'string' ? p.meal : '');
            const firstSeg = segments[0] || {};
            const dep = (firstSeg.departure || {}).airport || '?';
            const arr = (firstSeg.arrival || {}).airport || '?';

            html += `<div class="seat-section-title">Seat & Meal Assignment</div>
            <div class="seat-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
                <div class="field-item seat-field" style="background:var(--bg-main); padding:0.5rem; border-radius:8px; border:1px solid var(--border);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <label style="color:var(--primary); font-weight:700; margin:0;">${dep} → ${arr}</label>
                        <button class="btn-action small success" onclick="addAncillary(${i}, 0)" style="padding: 2px 8px; font-size: 11px;">+ Service</button>
                    </div>
                    <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                        <input type="text" placeholder="Seat (e.g. 12A)" value="${safe(typeof seatNum === 'object' ? seatNum.seat_number : seatNum)}" onchange="updateSeatForSegment(${i}, 0, this.value)" style="flex:1;">
                        <input type="text" placeholder="Meal (e.g. VGML)" value="${safe(mealObj)}" onchange="updateMealForSegment(${i}, 0, this.value)" style="flex:1;">
                    </div>
                    ${getAncHTML(i, 0)}
                    ${getBarcodeHTML(0)}
                </div>
            </div>`;
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
        const markupTotal = globalMarkup * passengers.length;
        const bothAddition = other + markupTotal;
        const total = base + k3 + bothAddition;

        html += `<table class="fare-table">
            <thead><tr>
                <th>Pax</th><th>Total Base Fare</th>
                <th>Airline GST (K3)</th><th>Other Taxes</th>
                <th>Markup (MU)</th>
                <th>Taxes + MU (PDF)</th>
                <th>Total Fare</th>
            </tr></thead><tbody>
            <tr>
                <td>${passengers.length}</td>
                <td><input type="number" value="${base}" onchange="editedData.journey.consolidated_fare.base_fare=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td><input type="number" value="${k3}" onchange="editedData.journey.consolidated_fare.k3_gst=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td>
                    <input type="number" id="cons-other" value="${other}" onchange="editedData.journey.consolidated_fare.other_taxes=parseFloat(this.value)||0; recalcFareGlobal()">
                </td>
                <td>
                    <input type="number" id="cons-markup" value="${markupTotal}" onchange="editedData.journey.global_markup=(parseFloat(this.value)||0)/${passengers.length || 1}; recalcFareGlobal()">
                    <div id="cons-markup-hint" style="font-size:0.7rem; color:var(--text-secondary); margin-top:4px;">
                        ${globalMarkup} / pax
                    </div>
                </td>
                <td style="color:var(--accent-primary); font-weight:600;" id="cons-both">${formatCurrency(bothAddition, curr)}</td>
                <td><strong id="cons-total">${formatCurrency(total, curr)}</strong></td>
            </tr>
            </tbody></table>`;
    } else {
        html += `<table class="fare-table">
            <thead><tr>
                <th>Sr</th><th>Passenger</th><th>Base Fare</th>
                <th>Airline GST (K3)</th><th>Other Taxes</th>
                <th>Markup (MU)</th>
                <th>Taxes + MU (PDF)</th>
                <th>Total Fare</th>
            </tr></thead><tbody>`;

        passengers.forEach((p, i) => {
            const fare = p.fare || {};
            const paxType = getPaxLabel(p.pax_type || p.type);
            const base = parseFloat(fare.base_fare) || 0;
            const k3 = parseFloat(fare.k3_gst) || 0;
            const other = parseFloat(fare.other_taxes) || 0;
            const bothAddition = other + globalMarkup;
            const total = base + k3 + bothAddition;

            if (!fare.total_fare || parseFloat(fare.total_fare) !== total) {
                if (!editedData.passengers[i].fare) editedData.passengers[i].fare = {};
                editedData.passengers[i].fare.total_fare = total;
            }

            html += `<tr>
                <td>${i + 1}</td>
                <td><strong>${safe(p.name, paxType)}</strong><br><small style="color:var(--text-secondary)">${paxType}</small></td>
                <td><input type="number" value="${base}" onchange="editedData.passengers[${i}].fare.base_fare=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td><input type="number" value="${k3}" onchange="editedData.passengers[${i}].fare.k3_gst=parseFloat(this.value)||0; recalcFareGlobal()"></td>
                <td>
                    <input type="number" id="pax-other-${i}" value="${other}" onchange="editedData.passengers[${i}].fare.other_taxes=parseFloat(this.value)||0; recalcFareGlobal()">
                </td>
                <td>
                    <input type="number" id="pax-markup-${i}" value="${globalMarkup}" onchange="editedData.journey.global_markup=parseFloat(this.value)||0; recalcFareGlobal()">
                </td>
                <td style="color:var(--accent-primary); font-weight:600;" id="pax-both-${i}">${formatCurrency(bothAddition, curr)}</td>
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
    const tStatus = editedData.ticket_status || 'live';
    const isCancelled = tStatus === 'cancelled';
    const isMergedView = !!editedData.is_merged_view;

    if (isMergedView) {
        document.getElementById('actionsSection').innerHTML = `
            <div class="section-header-row"><h2>âš¡ Actions</h2></div>
            <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
                <div class="pdf-btn-group">
                    <button class="pdf-btn with-fare" onclick="downloadPDF(true)">ðŸ“„ PDF (With Fare)</button>
                    <button class="pdf-btn without-fare" onclick="downloadPDF(false)">ðŸ“„ PDF (Without Fare)</button>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                    <span style="font-weight:700; color:#059669;">Merged booking view. Passenger tickets are grouped here as one booking.</span>
                </div>
            </div>`;
        return;
    }

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
                <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Sheet Export:</span>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('AB')">📊 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('CK')">📊 CK</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('AB')">📒 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('CK')">📒 CK</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(16,185,129,0.2);">
                        <span style="font-weight:700; color:#10b981;">✅ In Ledger</span>
                    </div>`}
                    ${!isCancelled ? `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.05); padding:0.5rem 1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.2);">
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#dc2626,#ef4444); color:white; padding:0.5rem 1rem;" onclick="openCancelModal()">❌ Cancel / Split</button>
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#d97706,#f59e0b); color:white; padding:0.5rem 1rem;" onclick="openChangeModal()">🔄 Change</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px dashed rgba(239,68,68,0.3);">
                        <span style="font-weight:700; color:#ef4444;">🔴 This ticket is cancelled</span>
                    </div>`}
                </div>`;
    loadLedgerAggregators();
}

async function loadLedgerAggregators() {
    try {
        const r = await fetch('/api/aggregators');
        if (!r.ok) return;
        const d = await r.json();
        const sel = document.getElementById('ledgerAggSelect');
        if (!sel) return;
        let html = '<option value="">Select aggregator</option>';
        (d.aggregators || []).forEach(a => {
            html += `<option value="${a.id}">${a.name}</option>`;
        });
        sel.innerHTML = html;
    } catch (e) { }
}

async function addToLedger(bookingBy) {
    if (document.activeElement) document.activeElement.blur();
    const sel = document.getElementById('ledgerAggSelect');
    const aggId = sel ? sel.value : '';
    if (!aggId) {
        showToast('Please select an aggregator first', 'error');
        return;
    }
    showToast('Adding to ledger...', 'info');
    try {
        await saveTicket();
        const r = await fetch(`/api/tickets/${currentTicket.id}/add-to-ledger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aggregator_id: aggId, booking_by: bookingBy })
        });
        const data = await r.json();
        if (!r.ok) {
            if (r.status === 402) {
                _showLowBalanceModal(data);
            } else if (r.status === 409) {
                showToast(data.error || 'Duplicate: ticket data unchanged since last ledger add', 'error');
            } else {
                showToast(data.error || 'Failed', 'error');
            }
            return;
        }
        showToast('Added to ledger!', 'success');
        await openTicket(currentTicket.id);
    } catch (e) {
        console.error(e);
        showToast('Network error', 'error');
    }
}

function _showLowBalanceModal(data) {
    const html = `
        <div style="text-align:center; padding:1.5rem;">
            <div style="font-size:3.5rem; margin-bottom:1rem; animation: bounce 2s infinite;">⚠️</div>
            <h2 style="margin-top:0; color:#ef4444; font-weight:800; letter-spacing:-0.02em;">Insufficient Ledger Balance</h2>
            <p style="color:var(--text-secondary); margin-bottom:1.5rem; font-size:1.1rem; line-height:1.5;">
                Your current balance for this aggregator is <br>
                <strong style="color:var(--text-primary); font-size:1.4rem;">${formatCurrency(data.current_balance, 'INR')}</strong><br>
                Required for this entry: <strong style="color:var(--text-primary); font-size:1.4rem;">${formatCurrency(data.required_amount, 'INR')}</strong>
            </p>
            
            <div style="background:rgba(239,68,68,0.06); border:2px dashed rgba(239,68,68,0.3); padding:1.2rem; border-radius:16px; margin-bottom:2rem;">
                <p style="margin:0; font-size:0.95rem; color:#ef4444; font-weight:700;">💰 Shortfall: ${formatCurrency(data.required_amount - data.current_balance, 'INR')}</p>
            </div>

            <div style="display:flex; flex-direction:column; gap:1rem;">
                <button class="btn-action primary" style="background:linear-gradient(135deg,#10b981,#059669); color:white; border:none; width:100%; padding:1rem; font-weight:700; font-size:1rem; box-shadow:0 4px 12px rgba(16,185,129,0.3);" onclick="window.location.href='/ledger?aggregator_id=${data.aggregator_id}&add_funds=true'">
                    🚀 Add Funds to Ledger Now
                </button>
                <button class="btn-action secondary" style="width:100%; border:1px solid var(--border); padding:0.8rem; background:transparent; font-weight:600;" onclick="_closeModal()">
                    Later
                </button>
            </div>
        </div>
    `;
    _createModalOverlay(html);
}

function recalcFareGlobal(redraw = true) {
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.fare_display) {
        editedData.journey.fare_display = (editedData.passengers || []).length <= 1 ? 'per_passenger' : 'consolidated';
    }
    const isConsolidated = editedData.journey.fare_display === 'consolidated';
    const globalMarkup = parseFloat(editedData.journey.global_markup) || 0;
    const curr = editedData.currency || 'INR';
    let gt = 0;

    if (isConsolidated) {
        const cf = editedData.journey.consolidated_fare || {};
        const passengersCount = (editedData.passengers || []).length;
        const other = parseFloat(cf.other_taxes) || 0;
        const markupTotal = globalMarkup * passengersCount;
        const bothAddition = other + markupTotal;
        const total = (parseFloat(cf.base_fare) || 0) + (parseFloat(cf.k3_gst) || 0) + bothAddition;
        gt = total;

        const otherEl = document.getElementById('cons-other');
        if (otherEl && redraw) otherEl.value = other;

        const markupEl = document.getElementById('cons-markup');
        if (markupEl && redraw) markupEl.value = markupTotal;

        const hintEl = document.getElementById('cons-markup-hint');
        if (hintEl && redraw) hintEl.textContent = `${globalMarkup} / pax`;

        const bothEl = document.getElementById('cons-both');
        if (bothEl && redraw) bothEl.textContent = formatCurrency(bothAddition, curr);

        const ct = document.getElementById('cons-total');
        if (ct && redraw) ct.textContent = formatCurrency(total, curr);
    } else {
        editedData.passengers.forEach((p, i) => {
            const f = p.fare || {};
            const base = parseFloat(f.base_fare) || 0;
            const k3 = parseFloat(f.k3_gst) || 0;
            const other = parseFloat(f.other_taxes) || 0;
            const bothAddition = other + globalMarkup;
            const total = base + k3 + bothAddition;
            f.total_fare = total;
            gt += total;

            const otherEl = document.getElementById('pax-other-' + i);
            if (otherEl && redraw) otherEl.value = other;

            const markupEl = document.getElementById('pax-markup-' + i);
            if (markupEl && redraw) markupEl.value = globalMarkup;

            // Sync global markups dynamically
            if (redraw && i > 0 && markupEl) markupEl.value = globalMarkup;

            const bothEl = document.getElementById('pax-both-' + i);
            if (bothEl && redraw) bothEl.textContent = formatCurrency(bothAddition, curr);

            const pt = document.getElementById('pax-total-' + i);
            if (pt && redraw) pt.textContent = formatCurrency(total, curr);
        });
    }

    editedData.grand_total = gt;

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

function updateMealForSegment(paxIdx, segIdx, value) {
    if (!editedData.passengers[paxIdx].meals) editedData.passengers[paxIdx].meals = [];
    const meals = editedData.passengers[paxIdx].meals;
    const existing = meals.findIndex(m => m.segment_index === segIdx);

    // Clear out old single-string meal to avoid confusing extraction
    if (editedData.passengers[paxIdx].meal) {
        delete editedData.passengers[paxIdx].meal;
    }

    if (existing >= 0) {
        meals[existing].name = value;
        meals[existing].code = value;
    } else {
        meals.push({ segment_index: segIdx, name: value, code: value });
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
    let selectedCabinClass = '';
    const bc = seg.booking_class;
    if (typeof bc === 'object' && bc !== null) {
        selectedCabinClass = bc.full_form || bc.cabin || bc.letter || '';
    } else if (typeof bc === 'string') {
        selectedCabinClass = bc.trim();
    }
    if (!seg.show_booking_class) {
        selectedCabinClass = '';
    }
    const cabinOptions = ['', 'Economy', 'Premium Economy', 'Business', 'First'];
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div id="segment-edit-modal-content" style="background:var(--bg-card);border-radius:16px;padding:2rem;max-width:750px;width:95%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0,0,0,0.3);" onclick="event.stopPropagation()">
            <h3 style="margin-top:0;">✏️ Edit Segment ${idx + 1}</h3>
            
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border);">
                <div class="field-item"><label>Airline</label><input type="text" id="seg-airline" value="${safe(seg.airline)}"></div>
                <div class="field-item"><label>Flight Number</label><input type="text" id="seg-fltnum" value="${safe(seg.flight_number)}"></div>
                <div class="field-item"><label>Cabin Class</label><select id="seg-class">${cabinOptions.map(option => `<option value="${option}" ${selectedCabinClass === option ? 'selected' : ''}>${option || 'Hidden by default'}</option>`).join('')}</select></div>
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
    const selectedCabinClass = document.getElementById('seg-class').value.trim();
    seg.show_booking_class = !!selectedCabinClass;
    if (selectedCabinClass) {
        seg.booking_class = selectedCabinClass;
    } else {
        delete seg.booking_class;
    }
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
    if (editedData.is_merged_view) {
        if (!silent) showToast('Merged booking views are read-only', 'info');
        return;
    }
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

async function exportToSheet(bookingBy) {
    if (document.activeElement) document.activeElement.blur();

    showToast('Exporting to Google Sheet...', 'info');
    try {
        await saveTicket(); // Ensure data is saved first
        const r = await fetch(`/api/tickets/${currentTicket.id}/export-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_by: bookingBy, type: 'New' })
        });
        const data = await r.json();
        if (!r.ok) {
            showToast(data.error || 'Export failed', 'error');
            return;
        }
        showToast('Successfully exported to Google Sheet!', 'success');
        await openTicket(currentTicket.id);
    } catch (e) {
        console.error(e);
        showToast('Export failed', 'error');
    }
}

// ==================== CANCEL / SPLIT / CHANGE MODALS ====================

function _createModalOverlay(innerHTML) {
    const overlay = document.createElement('div');
    overlay.id = 'cancel-change-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);animation:fadeIn 0.2s ease;';
    overlay.innerHTML = `<div style="background:var(--bg-card);border-radius:20px;padding:2rem;max-width:680px;width:95%;max-height:88vh;overflow-y:auto;box-shadow:0 24px 48px rgba(0,0,0,0.35);border:1px solid var(--border);" onclick="event.stopPropagation()">${innerHTML}</div>`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    return overlay;
}

function _closeModal() {
    const m = document.getElementById('cancel-change-modal');
    if (m) m.remove();
}

// ========== CANCEL MODAL ==========
function openCancelModal() {
    if (!editedData || !editedData.passengers || editedData.passengers.length === 0) {
        showToast('No passengers to cancel', 'error');
        return;
    }
    
    // Requirement: Check if added to ledger
    if (!editedData.ledger_hash) {
        showToast('Please add this booking to the ledger first before cancelling.', 'warning');
        return;
    }

    _openWorkflowModal('cancel');
}

// ========== CHANGE MODAL ==========
function openChangeModal() {
    if (!editedData || !editedData.passengers || editedData.passengers.length === 0) {
        showToast('No passengers to change', 'error');
        return;
    }
    
    // Requirement: Check if added to ledger
    if (!editedData.ledger_hash) {
        showToast('Please add this booking to the ledger first before changing.', 'warning');
        return;
    }

    changeAttachmentState = { token: '', filename: '' };
    _openWorkflowModal('change');
}

function _openWorkflowModal(mode) {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    // If multi-sector, first pick sector(s)
    if (legs.length > 1) {
        _workflowStep_SectorSelect(legs, segments, mode);
    } else {
        _workflowStep_PassengerSelect(null, mode);
    }
}

function _workflowStep_SectorSelect(legs, segments, mode) {
    let modeLabel = mode === 'cancel' ? 'Cancel' : 'Change';
    let html = `<h3 style="margin-top:0;display:flex;align-items:center;gap:0.5rem;">\u2708\ufe0f Select Sector to ${modeLabel}</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1rem;">Select which sector(s) to ${mode.toLowerCase()}.</p>
    <div style="display:flex;flex-direction:column;gap:0.75rem;" id="sectorChoices">`;

    legs.forEach((legIndices, legIdx) => {
        const firstSeg = segments[legIndices[0]] || {};
        const lastSeg = segments[legIndices[legIndices.length - 1]] || {};
        const dep = (firstSeg.departure || {}).airport || '???';
        const arr = (lastSeg.arrival || {}).airport || '???';
        const depDate = (firstSeg.departure || {}).date || '';

        const isCancelled = legIndices.every(idx => (segments[idx] || {}).status === 'cancelled');
        const isPartial = !isCancelled && legIndices.some(idx => (segments[idx] || {}).status === 'cancelled');

        html += `<label style="display:flex;align-items:center;gap:0.75rem;padding:1rem;border-radius:12px;border:2px solid var(--border);${isCancelled ? 'opacity:0.6; cursor:not-allowed;' : 'cursor:pointer; transition:all 0.2s;'}" 
            ${!isCancelled ? `onmouseover="this.style.borderColor='var(--primary)'" onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='var(--border)'" onclick="this.querySelector('input').checked=!this.querySelector('input').checked; this.style.borderColor=this.querySelector('input').checked?'var(--primary)':'var(--border)'; this.style.background=this.querySelector('input').checked?'rgba(37,99,235,0.06)':'transparent'"` : ''}>
            <input type="checkbox" value="${legIdx}" style="display:none;" class="sector-cb" ${isCancelled ? 'disabled' : ''}>
            <div style="width:42px;height:42px;background:linear-gradient(135deg,${isCancelled ? '#94a3b8,#cbd5e1' : '#1e40af,#3b82f6'});color:white;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;">L${legIdx + 1}</div>
            <div style="flex:1;">
                <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:0.5rem;">
                    ${dep} \u2192 ${arr}
                    ${isCancelled ? '<span style="background:#ef4444;color:white;font-size:0.6rem;padding:1px 4px;border-radius:4px;">CANCELLED</span>' : ''}
                    ${isPartial ? '<span style="background:#f59e0b;color:white;font-size:0.6rem;padding:1px 4px;border-radius:4px;">PARTIAL</span>' : ''}
                </div>
                <div style="font-size:0.78rem;color:var(--text-secondary);">${depDate}</div>
            </div>
        </label>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn-action primary" onclick="_onSectorNext('${mode}')">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onSectorNext(mode) {
    const cbs = document.querySelectorAll('.sector-cb');
    const selectedSectors = [];
    cbs.forEach(cb => { if (cb.checked) selectedSectors.push(parseInt(cb.value)); });
    if (selectedSectors.length === 0) {
        showToast('Please select at least one sector', 'error');
        return;
    }
    _closeModal();
    _workflowStep_PassengerSelect(selectedSectors, mode);
}

function _workflowStep_PassengerSelect(sectorIndices, mode) {
    const passengers = editedData.passengers || [];
    const n = passengers.length;
    let modeLabel = mode === 'cancel' ? 'Cancel' : 'Change';

    let html = `<h3 style="margin-top:0;display:flex;align-items:center;gap:0.5rem;">\ud83d\udc65 Select Passengers to ${modeLabel}</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:0.5rem;">Click to select. <strong>All selected = full ${mode.toLowerCase()}.</strong> Fewer = PNR split.</p>
    
    <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;font-size:0.9rem;cursor:pointer;font-weight:600;color:var(--primary);">
        <input type="checkbox" id="selectAllPax" onchange="const cbs=document.querySelectorAll('.pax-cb'); cbs.forEach(cb=>cb.checked=this.checked); cbs.forEach(cb=>cb.parentElement.style.borderColor=this.checked?'var(--primary)':'var(--border)'); cbs.forEach(cb=>cb.parentElement.style.background=this.checked?'rgba(37,99,235,0.06)':'transparent')"> Select All Passengers
    </label>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem;" id="paxChoices">`;

    passengers.forEach((p, i) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        html += `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border-radius:12px;border:2px solid var(--border);cursor:pointer;transition:all 0.2s;" onclick="this.querySelector('input').checked=!this.querySelector('input').checked; this.style.borderColor=this.querySelector('input').checked?'var(--primary)':'var(--border)'; this.style.background=this.querySelector('input').checked?'rgba(37,99,235,0.06)':'transparent'">
            <input type="checkbox" value="${i}" style="display:none;" class="pax-cb">
            <div style="width:36px;height:36px;background:var(--bg-tertiary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:1px solid var(--border);">👤</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary);">${paxType} • ${p.ticket_number || 'No Ticket'}</div>
            </div>
        </label>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn-action primary" onclick="_onPaxNext('${mode}', ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')})">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onPaxNext(mode, sectorIndices) {
    const passengers = editedData.passengers || [];
    const cbs = document.querySelectorAll('.pax-cb');
    const selectedPax = [];
    cbs.forEach(cb => { if (cb.checked) selectedPax.push(parseInt(cb.value)); });
    if (selectedPax.length === 0) {
        showToast('Please select at least one passenger', 'error');
        return;
    }
    _closeModal();

    if (mode === 'cancel') {
        const hasSpecial = passengers.some(p => {
            const t = (p.pax_type || p.type || '').toUpperCase();
            return ['CHD', 'CNN', 'CHILD', 'INF', 'INFANT'].includes(t);
        });

        // Requirement: If sectors are selected, we MUST ask for those sector fares
        if (sectorIndices && sectorIndices.length > 0) {
            _workflowStep_SectorFareSplit(sectorIndices, selectedPax, mode);
        } else if (selectedPax.length < passengers.length && hasSpecial) {
             _workflowStep_FareSplit(sectorIndices, selectedPax, mode);
        } else if (selectedPax.length < passengers.length) {
             _cancelStep_ConfirmPartial(sectorIndices, selectedPax, null);
        } else {
             _cancelStep_ConfirmFull(sectorIndices, selectedPax);
        }
    } else {
        // MODE CHANGE
        _changeStep_ExtraFares(sectorIndices, selectedPax);
    }
}

function _workflowStep_FareSplit(sectorIndices, selectedPax, mode, sectorFares) {
    const passengers = editedData.passengers || [];
    const journey = editedData.journey || {};
    let totalBase = 0, totalK3 = 0, totalOther = 0;
    
    if (journey.consolidated_fare) {
        totalBase = parseFloat(journey.consolidated_fare.base_fare) || 0;
        totalK3 = parseFloat(journey.consolidated_fare.k3_gst) || 0;
        totalOther = parseFloat(journey.consolidated_fare.other_taxes) || 0;
    } else {
        passengers.forEach(p => {
            const f = p.fare || {};
            totalBase += parseFloat(f.base_fare) || 0;
            totalK3 += parseFloat(f.k3_gst) || 0;
            totalOther += parseFloat(f.other_taxes) || 0;
        });
    }

    let html = `<h3 style="margin-top:0;">\ud83d\udcb0 Fare Split (Unequal)</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1rem;">
        Enter individual share of ORIGINAL fare for each passenger.<br>
        <strong>Total:</strong> Base \u20b9${totalBase.toLocaleString('en-IN')} | K3 \u20b9${totalK3.toLocaleString('en-IN')} | Other \u20b9${totalOther.toLocaleString('en-IN')}
    </p>
    <div style="display:flex;flex-direction:column;gap:0.75rem;">`;

    passengers.forEach((p, i) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        const isSelected = selectedPax.includes(i);
        const f = p.fare || {};
        const defBase = parseFloat(f.base_fare) || (totalBase / passengers.length);
        const defK3 = parseFloat(f.k3_gst) || (totalK3 / passengers.length);
        const defOther = parseFloat(f.other_taxes) || (totalOther / passengers.length);

        html += `<div style="padding:0.75rem;border-radius:10px;border:1px solid ${isSelected ? 'rgba(37,99,235,0.4)' : 'var(--border)'};background:${isSelected ? 'rgba(37,99,235,0.04)' : 'var(--bg-main)'};">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <strong>${safe(p.name, 'Passenger ' + (i + 1))}</strong>
                <span style="font-size:0.75rem;color:var(--text-secondary);">(${paxType})</span>
                ${isSelected ? '<span style="color:var(--primary);font-size:0.75rem;font-weight:700;">PROCESSED</span>' : '<span style="color:#10b981;font-size:0.75rem;font-weight:700;">REMAINING</span>'}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
                <div class="field-item"><label>Base Fare</label><input type="number" id="split-base-${i}" value="${Math.round(defBase)}" style="font-size:0.85rem;"></div>
                <div class="field-item"><label>K3 GST</label><input type="number" id="split-k3-${i}" value="${Math.round(defK3)}" style="font-size:0.85rem;"></div>
                <div class="field-item"><label>Other Taxes</label><input type="number" id="split-other-${i}" value="${Math.round(defOther)}" style="font-size:0.85rem;"></div>
            </div>
        </div>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" onclick="_onFareSplitNext('${mode}', ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, ${sectorFares ? JSON.stringify(sectorFares).replace(/"/g, '&quot;') : 'null'})">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onFareSplitNext(mode, sectorIndices, selectedPax, sectorFares) {
    const passengers = editedData.passengers || [];
    const perPersonFares = [];
    for (let i = 0; i < passengers.length; i++) {
        perPersonFares.push({
            base_fare: parseFloat(document.getElementById('split-base-' + i)?.value) || 0,
            k3_gst: parseFloat(document.getElementById('split-k3-' + i)?.value) || 0,
            other_taxes: parseFloat(document.getElementById('split-other-' + i)?.value) || 0,
        });
    }
    _closeModal();
    if (mode === 'cancel') {
        _cancelStep_ConfirmPartial(sectorIndices, selectedPax, perPersonFares, sectorFares);
    } else {
        _changeStep_ExtraFares(sectorIndices, selectedPax, perPersonFares);
    }
}

function _cancelStep_ConfirmFull(sectorIndices, selectedPax, sectorFares) {
    const hasPersistent = !!editedData.last_aggregator;
    let html = `<h3 style="margin-top:0;color:#ef4444;">\u274c Full Cancellation</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;">All passengers selected. This will cancel the entire booking.</p>
    <div style="margin:1.5rem 0;display:flex;flex-direction:column;gap:1rem;">
        <div class="field-item">
            <label>Cancellation Charge (XXD)</label>
            <input type="number" id="cancel-charge" value="0" placeholder="Enter cancellation charge" style="font-size:1rem;font-weight:600;">
        </div>
        ${!hasPersistent ? `
        <div class="field-item">
            <label>Add to Ledger (Aggregator)</label>
            <select id="cancel-agg-select" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="">No ledger entry</option>
            </select>
        </div>
        <div class="field-item">
            <label>Booked By</label>
            <select id="cancel-booking-by" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="AB">AB</option>
                <option value="CK">CK</option>
            </select>
        </div>` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Reusing existing aggregator and booked-by details.</p>`}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" style="background:linear-gradient(135deg,#dc2626,#ef4444);color:white;" onclick="_executeCancel(${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, true, null, ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${sectorFares ? JSON.stringify(sectorFares).replace(/"/g, '&quot;') : 'null'})">Confirm Cancellation</button>
    </div>`;

    const overlay = _createModalOverlay(html);
    if (!hasPersistent) _loadAggregatorsIntoSelect('cancel-agg-select');
}

function _cancelStep_ConfirmPartial(sectorIndices, selectedPax, perPersonFares, sectorFares) {
    const passengers = editedData.passengers || [];
    const cancelledNames = selectedPax.map(i => safe(passengers[i]?.name, 'Passenger ' + (i + 1))).join(', ');
    const remainingCount = passengers.length - selectedPax.length;
    const hasPersistent = !!editedData.last_aggregator;

    let html = `<h3 style="margin-top:0;color:#d97706;">\u2702\ufe0f PNR Split & Partial Cancellation</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;">
        <strong>${selectedPax.length}</strong> passenger(s) will be split out and cancelled: <strong>${cancelledNames}</strong><br>
        <strong>${remainingCount}</strong> passenger(s) remain on original PNR.
    </p>
    <div style="margin:1.5rem 0;display:flex;flex-direction:column;gap:1rem;">
        <div class="field-item">
            <label>New PNR for Cancelled Passengers</label>
            <input type="text" id="split-new-pnr" placeholder="Enter new PNR (e.g. ABC123)" style="font-size:1rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;">
        </div>
        <div class="field-item">
            <label>Cancellation Charge (XXD)</label>
            <input type="number" id="cancel-charge" value="0" placeholder="Enter cancellation charge" style="font-size:1rem;font-weight:600;">
        </div>
        ${!hasPersistent ? `
        <div class="field-item">
            <label>Add to Ledger (Aggregator)</label>
            <select id="cancel-agg-select" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="">No ledger entry</option>
            </select>
        </div>
        <div class="field-item">
            <label>Booked By</label>
            <select id="cancel-booking-by" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="AB">AB</option>
                <option value="CK">CK</option>
            </select>
        </div>` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Reusing existing aggregator and booked-by details.</p>`}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" style="background:linear-gradient(135deg,#d97706,#f59e0b);color:white;" onclick="_executeCancel(${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, false, ${perPersonFares ? JSON.stringify(perPersonFares).replace(/"/g, '&quot;') : 'null'}, ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${sectorFares ? JSON.stringify(sectorFares).replace(/"/g, '&quot;') : 'null'})">Confirm Split & Cancel</button>
    </div>`;

    const overlay = _createModalOverlay(html);
    if (!hasPersistent) _loadAggregatorsIntoSelect('cancel-agg-select');
}

// ========== SECTOR-WISE FARE INPUT ==========
function _workflowStep_SectorFareSplit(sectorIndices, selectedPax, mode) {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    let totalBase = 0, totalK3 = 0, totalOther = 0;
    
    if (journey.consolidated_fare) {
        totalBase = parseFloat(journey.consolidated_fare.base_fare) || 0;
        totalK3 = parseFloat(journey.consolidated_fare.k3_gst) || 0;
        totalOther = parseFloat(journey.consolidated_fare.other_taxes) || 0;
    } else {
        (editedData.passengers || []).forEach(p => {
            const f = p.fare || {};
            totalBase += parseFloat(f.base_fare) || 0;
            totalK3 += parseFloat(f.k3_gst) || 0;
            totalOther += parseFloat(f.other_taxes) || 0;
        });
    }

    let html = `<h3 style="margin-top:0;">🛑 Sector-wise Refund Details</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1rem;">
        Select fares for the <strong>selected sectors (${sectorIndices.length})</strong> that you want to refund.<br>
        <strong>Total Original PNR Fare:</strong> ₹${(totalBase+totalK3+totalOther).toLocaleString('en-IN')}
    </p>
    <div style="display:flex;flex-direction:column;gap:1rem;">`;

    sectorIndices.forEach(legIdx => {
        let legs;
        if (journey.legs && journey.legs.length > 0) {
            legs = journey.legs.map(leg => leg.segments || []);
        } else {
            legs = groupSegmentsIntoLegs(segments);
        }
        const segIndices = legs[legIdx] || [];
        const firstSeg = segments[segIndices[0]] || {};
        const lastSeg = segments[segIndices[segIndices.length-1]] || {};
        const routeStr = `${(firstSeg.departure||{}).airport} \u2192 ${(lastSeg.arrival||{}).airport}`;

        html += `<div style="padding:1rem; border-radius:12px; background:rgba(37,99,235,0.03); border:1px solid var(--border);">
            <div style="font-weight:700; margin-bottom:0.75rem; color:var(--primary); font-size:1rem;">Sector: ${routeStr}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.75rem;">
                <div class="field-item"><label>Sector Base</label><input type="number" id="sector-base-${legIdx}" value="0"></div>
                <div class="field-item"><label>Sector K3</label><input type="number" id="sector-k3-${legIdx}" value="0"></div>
                <div class="field-item"><label>Sector Other</label><input type="number" id="sector-other-${legIdx}" value="0"></div>
            </div>
        </div>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn-action primary" onclick="_onSectorFareNext('${mode}', ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${JSON.stringify(selectedPax).replace(/"/g, '&quot;')})">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onSectorFareNext(mode, sectorIndices, selectedPax) {
    const sectorFares = [];
    sectorIndices.forEach(idx => {
        sectorFares.push({
            leg_idx: idx,
            base_fare: parseFloat(document.getElementById('sector-base-'+idx)?.value) || 0,
            k3_gst: parseFloat(document.getElementById('sector-k3-'+idx)?.value) || 0,
            other_taxes: parseFloat(document.getElementById('sector-other-'+idx)?.value) || 0
        });
    });
    _closeModal();
    
    const passengers = editedData.passengers || [];
    const hasSpecial = passengers.some(p => {
        const t = (p.pax_type || p.type || '').toUpperCase();
        return ['CHD', 'CNN', 'CHILD', 'INF', 'INFANT'].includes(t);
    });

    if (selectedPax.length < passengers.length && hasSpecial) {
         _workflowStep_FareSplit(sectorIndices, selectedPax, mode, sectorFares);
    } else if (selectedPax.length < passengers.length) {
         _cancelStep_ConfirmPartial(sectorIndices, selectedPax, null, sectorFares);
    } else {
         _cancelStep_ConfirmFull(sectorIndices, selectedPax, sectorFares);
    }
}

// ========== CHANGE WORKFLOW STEPS ==========

function _changeStep_ExtraFares(sectorIndices, selectedPax, perPersonFares) {
    const passengers = editedData.passengers || [];
    const isSplit = selectedPax.length < passengers.length;
    const changingNames = selectedPax.map(i => safe(passengers[i]?.name, 'Passenger ' + (i + 1))).join(', ');
    const hasPersistent = !!editedData.last_aggregator;

    let html = `<h3 style="margin-top:0;color:var(--primary);">\ud83d\udd04 Step 3: Change Details</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;">
        Entering extra amounts for: <strong>${isSplit ? changingNames : 'Whole Booking'}</strong>
    </p>
    <div style="margin:1.5rem 0;display:flex;flex-direction:column;gap:1rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
            <div class="field-item"><label>EXTRA Base</label><input type="number" id="change-extra-base" value="0"></div>
            <div class="field-item"><label>EXTRA K3</label><input type="number" id="change-extra-k3" value="0"></div>
            <div class="field-item"><label>EXTRA Other</label><input type="number" id="change-extra-other" value="0"></div>
        </div>
        <div class="field-item">
            <label>Change/Cancellation Charge (XXD)</label>
            <input type="number" id="change-xxd" value="0" placeholder="Enter change charge">
        </div>
        <div class="field-item">
            <label>Upload New Ticket</label>
            <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
                <input type="file" id="change-ticket-file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="flex:1;min-width:220px;">
                <button type="button" class="btn-action secondary" onclick="_uploadChangeAttachment()">Upload</button>
            </div>
            <div id="change-upload-status" style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-secondary);">
                ${changeAttachmentState.filename ? `Uploaded: <strong>${changeAttachmentState.filename}</strong>` : 'Upload the revised ticket before confirmation.'}
            </div>
        </div>
        ${isSplit ? `
        <div class="field-item">
            <label>New PNR (optional)</label>
            <input type="text" id="change-new-pnr" placeholder="Leave empty to keep current PNR" style="text-transform:uppercase;letter-spacing:1px;">
        </div>` : ''}
        <div class="field-item">
            <label>Remarks</label>
            <input type="text" id="change-remarks" value="Ticket changed" placeholder="Reason for change">
        </div>
        ${!hasPersistent ? `
        <div class="field-item">
            <label>Add to Ledger (Aggregator)</label>
            <select id="change-agg-select" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="">No ledger entry</option>
            </select>
        </div>
        <div class="field-item">
            <label>Booked By</label>
            <select id="change-booking-by" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="AB">AB</option>
                <option value="CK">CK</option>
            </select>
        </div>` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Reusing existing aggregator and booked-by details.</p>`}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" onclick="_executeChange(${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, ${perPersonFares ? JSON.stringify(perPersonFares).replace(/"/g, '&quot;') : 'null'})">Confirm Change</button>
    </div>`;

    const overlay = _createModalOverlay(html);
    if (!hasPersistent) _loadAggregatorsIntoSelect('change-agg-select');
}

async function _uploadChangeAttachment() {
    const input = document.getElementById('change-ticket-file');
    const file = input?.files?.[0];
    if (!file) {
        showToast('Choose the revised ticket file first', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const r = await fetch(`/api/tickets/${currentTicket.id}/change-attachment`, {
            method: 'POST',
            body: formData
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || 'Upload failed', 'error');
            return;
        }
        changeAttachmentState = {
            token: result.attachment_token,
            filename: result.filename
        };
        const status = document.getElementById('change-upload-status');
        if (status) status.innerHTML = `Uploaded: <strong>${result.filename}</strong>`;
        showToast('New ticket uploaded', 'success');
    } catch (e) {
        console.error(e);
        showToast('Upload failed', 'error');
    }
}

function _buildPreviewHtml(summary, actionType) {
    const money = (value) => formatCurrency(value || 0, editedData.currency || 'INR');
    const paxHtml = (summary.affected_passengers || []).map(p => `<div style="padding:0.55rem 0.7rem;border:1px solid var(--border);border-radius:10px;background:var(--bg-main);">
        <div style="font-weight:700;">${p.name}</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">${p.system_ticket_number || 'No system ID'}</div>
    </div>`).join('');
    const sectorHtml = (summary.affected_sectors || []).map(s => `<div style="padding:0.55rem 0.7rem;border:1px solid var(--border);border-radius:10px;background:var(--bg-main);font-weight:600;">${s}</div>`).join('');
    const bookingsHtml = (summary.resulting_bookings || []).map(b => `<div style="padding:0.75rem;border:1px solid var(--border);border-radius:12px;background:var(--bg-main);">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
            <strong>${b.label}</strong>
            <span>${b.ticket_status.toUpperCase()}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.35rem;">PNR: ${b.pnr || 'No PNR'} | Pax: ${b.passenger_count} | Sectors: ${b.sector_count}</div>
        <div style="margin-top:0.35rem;font-weight:700;">${money(b.grand_total)}</div>
    </div>`).join('');

    return `
        <h3 style="margin-top:0;">Preview ${actionType === 'cancel' ? 'Cancellation' : 'Change'}</h3>
        <div style="display:grid;gap:1rem;">
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">Scenario</div>
                <div style="font-size:1rem;font-weight:700;margin-top:0.2rem;">${(summary.scenario || '').replace(/_/g, ' + ').toUpperCase()}</div>
            </div>
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;margin-bottom:0.45rem;">Affected Passengers</div>
                <div style="display:grid;gap:0.5rem;">${paxHtml}</div>
            </div>
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;margin-bottom:0.45rem;">Affected Sectors</div>
                <div style="display:grid;gap:0.5rem;">${sectorHtml}</div>
            </div>
            <div style="padding:0.9rem;border-radius:14px;background:rgba(37,99,235,0.05);border:1px solid var(--border);">
                <div style="font-weight:700;margin-bottom:0.5rem;">Fare Summary</div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.45rem;font-size:0.88rem;">
                    <div>Affected Fare: ${money(summary.affected_fare?.total)}</div>
                    <div>Operation Fee: ${money(summary.fees?.operation_fee)}</div>
                    ${actionType === 'change' ? `<div>Extra Fare: ${money(summary.fees?.extra_fare?.total)}</div>` : ''}
                    <div>${actionType === 'cancel' ? 'Net Refund' : 'Total Collection'}: <strong>${money(actionType === 'cancel' ? summary.financial_impact?.refund_amount : summary.financial_impact?.additional_collection)}</strong></div>
                </div>
            </div>
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;margin-bottom:0.45rem;">Resulting Bookings</div>
                <div style="display:grid;gap:0.65rem;">${bookingsHtml}</div>
            </div>
        </div>`;
}

function _showOperationPreview(summary, actionType, payload) {
    const confirmLabel = actionType === 'cancel' ? 'Confirm Cancellation' : 'Confirm Change';
    const html = `${_buildPreviewHtml(summary, actionType)}
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
            <button class="btn-action secondary" onclick="_closeModal()">Back</button>
            <button class="btn-action primary" onclick='_confirmOperation("${actionType}", ${JSON.stringify(payload).replace(/"/g, '&quot;')})'>${confirmLabel}</button>
        </div>`;
    _createModalOverlay(html);
}

async function _confirmOperation(actionType, payload) {
    _closeModal();
    showToast(`Processing ${actionType}...`, 'info');

    try {
        await saveTicket(true);
        const endpoint = actionType === 'cancel' ? 'cancel' : 'change';
        const r = await fetch(`/api/tickets/${currentTicket.id}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || `${actionType} failed`, 'error');
            return;
        }
        showToast(result.message || `${actionType} completed`, 'success');
        await openTicket(currentTicket.id);
    } catch (e) {
        console.error(e);
        showToast(`${actionType} failed`, 'error');
    }
}

async function _executeChange(selectedPax, perPersonFares) {
    const extraBase = parseFloat(document.getElementById('change-extra-base')?.value) || 0;
    const extraK3 = parseFloat(document.getElementById('change-extra-k3')?.value) || 0;
    const extraOther = parseFloat(document.getElementById('change-extra-other')?.value) || 0;
    const xxdCharge = parseFloat(document.getElementById('change-xxd')?.value) || 0;
    const newPnr = document.getElementById('change-new-pnr')?.value?.toUpperCase() || '';
    const remarks = document.getElementById('change-remarks')?.value || 'Ticket changed';
    const aggId = document.getElementById('change-agg-select')?.value || '';
    const bookingBy = document.getElementById('change-booking-by')?.value || 'AB';

    if (!changeAttachmentState.token) {
        showToast('Upload the new ticket before confirmation', 'error');
        return;
    }

    _closeModal();

    try {
        await saveTicket(true);
        const body = {
            action_type: 'change',
            passenger_indices: selectedPax,
            extra_fare: { base_fare: extraBase, k3_gst: extraK3, other_taxes: extraOther },
            xxd_charge: xxdCharge,
            remarks: remarks,
            per_person_fares: perPersonFares,
            attachment_token: changeAttachmentState.token
        };
        if (aggId) body.aggregator_id = aggId;
        if (bookingBy) body.booking_by = bookingBy;
        if (newPnr) body.new_pnr = newPnr;

        const r = await fetch(`/api/tickets/${currentTicket.id}/operations/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const summary = await r.json();
        if (!r.ok) {
            showToast(summary.error || 'Preview failed', 'error');
            return;
        }
        _showOperationPreview(summary, 'change', body);
    } catch (e) {
        console.error(e);
        showToast('Change preview failed', 'error');
    }
}


async function _loadAggregatorsIntoSelect(selectId) {
    try {
        const r = await fetch('/api/aggregators');
        if (!r.ok) return;
        const d = await r.json();
        const sel = document.getElementById(selectId);
        if (!sel) return;
        let html = '<option value="">No ledger entry</option>';
        (d.aggregators || []).forEach(a => {
            html += `<option value="${a.id}">${a.name}</option>`;
        });
        sel.innerHTML = html;
    } catch (e) { }
}

async function _executeCancel(selectedPax, isFullCancel, perPersonFares, sectorIndices, sectorFares) {
    const charge = parseFloat(document.getElementById('cancel-charge')?.value) || 0;
    const aggId = document.getElementById('cancel-agg-select')?.value || '';
    const bookingBy = document.getElementById('cancel-booking-by')?.value || 'AB';
    const newPnr = document.getElementById('split-new-pnr')?.value?.toUpperCase() || '';

    if (!isFullCancel && !newPnr) {
        showToast('Please enter a new PNR for the split passengers', 'error');
        return;
    }
    try {
        await saveTicket(true);
        const body = {
            action_type: 'cancel',
            passenger_indices: selectedPax,
            cancellation_charge: charge,
            booking_by: bookingBy,
            sector_indices: sectorIndices || [],
            sector_fares: sectorFares || null
        };
        if (aggId) body.aggregator_id = aggId;
        if (newPnr) body.new_pnr = newPnr;
        if (perPersonFares) body.per_person_fares = perPersonFares;

        _closeModal();
        const r = await fetch(`/api/tickets/${currentTicket.id}/operations/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const summary = await r.json();
        if (!r.ok) {
            showToast(summary.error || 'Preview failed', 'error');
            return;
        }
        _showOperationPreview(summary, 'cancel', body);
    } catch (e) {
        console.error(e);
        showToast('Cancellation preview failed', 'error');
    }
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
