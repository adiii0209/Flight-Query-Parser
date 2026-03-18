import re
with open("static/tickets.js", "r") as f:
    code = f.read()

replacement = """function openCancelModal() {
    if (!currentTicket) return;
    const pnrEl = document.getElementById("cancelPnrDisplay");
    if (pnrEl) pnrEl.textContent = editedData.pnr || "N/A";
    
    // Check if multiple sectors
    const segments = editedData.segments || [];
    let sectorHtml = "";
    if (segments.length > 1) {
        sectorHtml = `<div style="margin-bottom:1rem; padding-bottom: 1rem; border-bottom: 1px dashed var(--border);">
            <label style="font-weight:700;">Select Sector to Cancel</label>
            <select id="cancelSectorSelect" style="width:100%; padding:0.5rem; margin-top:0.5rem; border-radius:8px; border:1px solid var(--border);">
                <option value="ALL">All Sectors (Entire Journey)</option>`;
        segments.forEach((seg, idx) => {
            const dep = (seg.departure || {}).airport || "";
            const arr = (seg.arrival || {}).airport || "";
            sectorHtml += `<option value="${idx}">Sector ${idx + 1}: ${dep} &rarr; ${arr}</option>`;
        });
        sectorHtml += `</select></div>`;
    } else {
        sectorHtml = `<input type="hidden" id="cancelSectorSelect" value="ALL">`;
    }

    const paxListEl = document.getElementById("cancelPaxList");
    if (paxListEl) {
        let html = sectorHtml;
        (editedData.passengers || []).forEach((p, idx) => {
            const f = p.fare || {};
            html += `<div style="display:flex; flex-direction:column; gap:0.5rem; padding:0.5rem; border:1px solid var(--border); border-radius:8px; margin-bottom:0.5rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                    <input type="checkbox" class="cancel-pax-cb" value="${idx}" checked onchange="updateCancelModalSplitInput()">
                    <span style="font-weight:700;"> ${safe(p.name, "Passenger " + (idx + 1))}</span>
                </label>
                <div class="pax-fare-inputs" id="pax-fare-${idx}" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.5rem; margin-top:0.2rem;">
                    <div><small>Base Fare</small><input type="number" class="can-base" style="width:100%; border:1px solid #ccc; border-radius:4px; padding:2px;" value="${f.base_fare||0}"></div>
                    <div><small>K3</small><input type="number" class="can-k3" style="width:100%; border:1px solid #ccc; border-radius:4px; padding:2px;" value="${f.k3_gst||0}"></div>
                    <div><small>Other</small><input type="number" class="can-oth" style="width:100%; border:1px solid #ccc; border-radius:4px; padding:2px;" value="${f.other_taxes||0}"></div>
                </div>
            </div>`;
        });
        paxListEl.innerHTML = html;
        // Strip padding/border from cancelPaxList to let items handle it
        paxListEl.style.padding = "0";
        paxListEl.style.background = "transparent";
        paxListEl.style.border = "none";
    }
    
    document.getElementById("splitPnrSection").style.display = "none";
    document.getElementById("splitNewPnr").value = "";
    document.getElementById("cancelChargeAmt").value = "0";
    
    document.getElementById("cancelModalOverlay").style.display = "flex";
}

function updateCancelModalSplitInput() {
    const cbs = document.querySelectorAll(".cancel-pax-cb");
    let total = cbs.length;
    let checked = 0;
    cbs.forEach((cb, idx) => {
        const fareDiv = document.getElementById("pax-fare-" + idx);
        if (cb.checked) {
            checked++;
            if (fareDiv) fareDiv.style.display = "grid";
        } else {
            if (fareDiv) fareDiv.style.display = "none";
        }
    });

    const sectorSelect = document.getElementById("cancelSectorSelect");
    const isSectorSplit = sectorSelect && sectorSelect.value !== "ALL";
    if ((checked > 0 && checked < total) || isSectorSplit) {
        document.getElementById("splitPnrSection").style.display = "block";
    } else {
        document.getElementById("splitPnrSection").style.display = "none";
    }
}

async function processCancellation() {
    const cbs = document.querySelectorAll(".cancel-pax-cb");
    let cancelledIndices = [];
    let customFares = {};
    cbs.forEach((cb, idx) => { 
        if (cb.checked) {
            cancelledIndices.push(parseInt(cb.value)); 
            const fareDiv = document.getElementById("pax-fare-" + idx);
            if (fareDiv) {
                const base = parseFloat(fareDiv.querySelector(".can-base").value) || 0;
                const k3 = parseFloat(fareDiv.querySelector(".can-k3").value) || 0;
                const oth = parseFloat(fareDiv.querySelector(".can-oth").value) || 0;
                customFares[idx] = { base_fare: base, k3_gst: k3, other_taxes: oth };
            }
        }
    });
    
    if (cancelledIndices.length === 0) {
        showToast("Please select at least one passenger to cancel", "error");
        return;
    }
    
    const cancelCharge = parseFloat(document.getElementById("cancelChargeAmt").value) || 0;
    const aggId = document.getElementById("cancelAggSelect").value;
    const bookingBy = document.getElementById("cancelBookingBy").value;
    const newPnr = document.getElementById("splitNewPnr").value.trim();
    const sectorSelect = document.getElementById("cancelSectorSelect");
    const cancelledSector = sectorSelect ? sectorSelect.value : "ALL";
    
    if (!aggId) {
        showToast("Please select a Ledger Aggregator", "error");
        return;
    }
    
    const isSectorSplit = cancelledSector !== "ALL";
    if ((cancelledIndices.length < cbs.length || isSectorSplit) && !newPnr) {
        showToast("Please enter a new PNR for the split passengers/sectors", "error");
        return;
    }
    
    showToast("Processing cancellation...", "info");
    document.getElementById("cancelModalOverlay").style.display = "none";

    try {
        await saveTicket(true); // Ensure recent changes are saved
        
        const payload = {
            aggregator_id: aggId,
            booking_by: bookingBy,
            cancellation_charge: cancelCharge,
            cancelled_pax_indices: cancelledIndices,
            new_pnr: newPnr,
            custom_fares: customFares,
            cancelled_sector: cancelledSector
        };
        
        const r = await fetch(`/api/tickets/${currentTicket.id}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await r.json();
        if (!r.ok) {
            showToast(data.error || "Failed to cancel", "error");
            return;
        }
        showToast("Cancellation successful", "success");
        showListView();
    } catch (e) {
        console.error(e);
        showToast("Network error", "error");
    }
}"""

import re
code = re.sub(r"function openCancelModal\(\) \{.*?(?=\n\nasync function addToLedger)", replacement, code, flags=re.DOTALL)

with open("static/tickets.js", "w") as f:
    f.write(code)

