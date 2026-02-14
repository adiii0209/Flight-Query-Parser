
function createAdditionalDetailsSection(unitId) {
    const sectionId = `additional-section-${unitId}`;
    return `
    <div class="shared-fare-section" id="${sectionId}" style="margin-top: 1rem; border: 1px solid var(--border); border-radius: 8px;">
      <div class="fare-section-header" onclick="toggleAdditionalSection('${unitId}')" style="background: var(--bg-hover); padding: 0.75rem 1rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-radius: 8px;">
        <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-primary);">Additional Details (Optional)</h4>
        <span class="fare-toggle-icon" id="add-toggle-${unitId}" style="transition: transform 0.3s ease;">▼</span>
      </div>
      <div class="fare-section-content" id="additional-content-${unitId}" style="display: none; padding: 1rem;">
        <div class="grid-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
          <div>
            <label class="form-label" style="font-size: 0.8rem;">Baggage</label>
            <input type="text" id="baggage-${unitId}" class="form-input" placeholder="e.g. 15kg">
          </div>
          <div>
            <label class="form-label" style="font-size: 0.8rem;">Seat</label>
            <input type="text" id="seat-${unitId}" class="form-input" placeholder="e.g. A12">
          </div>
        </div>
        <div class="grid-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
          <div>
            <label class="form-label" style="font-size: 0.8rem;">Meal</label>
            <input type="text" id="meal-${unitId}" class="form-input" placeholder="e.g. Veg Meal">
          </div>
           <div>
            <label class="form-label" style="font-size: 0.8rem;">Cancellation Charges</label>
            <input type="text" id="cancellation-${unitId}" class="form-input" placeholder="e.g. ₹3000">
          </div>
        </div>
        <div style="margin-bottom:10px;">
             <label class="form-label" style="font-size: 0.8rem;">Penalty Charges</label>
             <input type="text" id="penalty-${unitId}" class="form-input" placeholder="e.g. ₹5000">
        </div>
      </div>
    </div>
  `;
}

function toggleAdditionalSection(unitId) {
    const content = document.getElementById(`additional-content-${unitId}`);
    const icon = document.getElementById(`add-toggle-${unitId}`);
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
    } else {
        content.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
    }
}
