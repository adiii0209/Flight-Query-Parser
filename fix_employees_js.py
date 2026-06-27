import re

with open(r'e:\Flight-Query-Parser\static\employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

# We know the function starts at `window.openEditEmployeeModal = function(id) {`
# And ends before `// ============================================================================`
# or `window.closeEditEmployeeModal` if it exists.

replacement = """window.openEditEmployeeModal = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  let modal = document.getElementById('ewEditEmployeeModal');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.className = 'crm-modal-overlay';
  modal.id = 'ewEditEmployeeModal';
  modal.style.zIndex = '10000';
  modal.innerHTML = `
    <div class="crm-modal" role="dialog" aria-modal="true" style="max-width:400px;">
      <div class="crm-modal-header">
        <div><div class="crm-modal-title">Edit Profile</div></div>
        <button class="crm-modal-close" onclick="document.getElementById('ewEditEmployeeModal').classList.remove('open')">✕</button>
      </div>
      <div class="crm-modal-body" style="display:flex; flex-direction:column; gap:1rem;">
        <div class="crm-form-group">
          <label class="crm-form-label">Name</label>
          <input type="text" class="crm-form-input" id="ewEditEmpName">
        </div>
        <div class="crm-form-group">
          <label class="crm-form-label">Email ID <span id="ewEmailLockedStatus" style="font-size: 0.75rem; color: #888; font-weight: normal;"></span></label>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <input type="email" class="crm-form-input" id="ewEditEmpEmail" placeholder="employee@agency.com" style="flex:1;">
            <button class="crm-btn crm-btn-secondary" id="ewSendInviteBtn" style="white-space:nowrap; font-size: 0.8rem; padding: 0.4rem 0.8rem;">Send Invite</button>
          </div>
        </div>
        <div class="crm-form-group">
          <label class="crm-form-label">Color Hex</label>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <input type="color" id="ewEditEmpColorPicker" style="width: 36px; height: 36px; padding: 0; border: none; cursor: pointer; border-radius: var(--crm-radius);">
            <input type="text" class="crm-form-input" id="ewEditEmpColor" placeholder="#000000" style="flex:1;">
          </div>
        </div>
        <div class="crm-form-group">
          <label class="crm-form-label">Domain</label>
          <select class="crm-form-select" id="ewEditEmpDomain">
            <option value="">None</option>
            <option value="Travel">Travel</option>
            <option value="Accounts">Accounts</option>
            <option value="Tech">Tech</option>
            <option value="Sales & Marketing">Sales & Marketing</option>
            <option value="HR">HR</option>
          </select>
        </div>
      </div>
      <div class="crm-modal-footer">
        <button class="crm-btn crm-btn-ghost" onclick="document.getElementById('ewEditEmployeeModal').classList.remove('open')">Cancel</button>
        <button class="crm-btn crm-btn-primary" id="ewEditEmpSaveBtn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('ewEditEmpName').value = emp.name;
  document.getElementById('ewEditEmpEmail').value = emp.email || '';
  
  const emailInput = document.getElementById('ewEditEmpEmail');
  const inviteBtn = document.getElementById('ewSendInviteBtn');
  const lockedStatus = document.getElementById('ewEmailLockedStatus');
  
  if (emp.user_id) {
    emailInput.readOnly = true;
    emailInput.style.opacity = '0.7';
    emailInput.title = 'Account claimed. Email is locked.';
    lockedStatus.textContent = '(Claimed)';
    inviteBtn.style.display = 'none';
  }
  
  const colorPicker = document.getElementById('ewEditEmpColorPicker');
  const colorInput = document.getElementById('ewEditEmpColor');
  colorInput.value = emp.color || '';
  if (/^#[0-9A-Fa-f]{6}$/.test(emp.color)) {
    colorPicker.value = emp.color;
  } else {
    colorPicker.value = '#000000';
  }

  colorPicker.oninput = () => { colorInput.value = colorPicker.value; };
  colorInput.oninput = () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(colorInput.value)) {
      colorPicker.value = colorInput.value;
    }
  };

  document.getElementById('ewEditEmpDomain').value = emp.domain || '';
  
  inviteBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await apiJson('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ employee_id: emp.id })
      });
      if (res.invite_link) {
        prompt('Invite generated! Send this secure link to the employee so they can register:', res.invite_link);
      }
    } catch(e) {
      toast(e.error || 'Failed to send invite', '⚠️');
    }
  };

  const saveBtn = document.getElementById('ewEditEmpSaveBtn');
  saveBtn.onclick = async () => {
    const newName = document.getElementById('ewEditEmpName').value.trim();
    const newEmail = document.getElementById('ewEditEmpEmail').value.trim();
    const newColor = document.getElementById('ewEditEmpColor').value.trim();
    const newDomain = document.getElementById('ewEditEmpDomain').value;
    if (!newName) return toast('Name required', '⚠️');
    
    try {
      const res = await apiJson('/api/ownership/employees/' + emp.id, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName, email: newEmail, color: newColor, domain: newDomain })
      });
      if (res.employee) {
        Object.assign(emp, res.employee);
        renderPicker();
        if (activeEmployee && isSameEmployeeId(activeEmployee.id, emp.id)) {
          Object.assign(activeEmployee, res.employee);
          syncWorkspaceTopStrip();
        }
      }
      modal.classList.remove('open');
      toast('Profile updated');
    } catch(e) {
      toast('Failed to update profile', '⚠️');
    }
  };

  // Trigger reflow
  modal.offsetHeight;
  modal.classList.add('open');
}

// END OF REPLACEMENT
"""

# Regex to replace from `window.openEditEmployeeModal = function(id) {` up to `// Trigger reflow... modal.classList.add('open'); }`
pattern = re.compile(r'window\.openEditEmployeeModal = function\(id\) \{.*?\n\}\n', re.DOTALL)

# Because it got mangled, maybe we should just split at `window.openEditEmployeeModal = function(id) {`
# and find the next function which is `window.createDummyUser` or something. Let's find the next function
# by looking for `window.`
match = re.search(r'window\.openEditEmployeeModal = function\(id\) \{.*?(?=window\.[a-zA-Z0-9]+ = function|// END OF FILE)', content, re.DOTALL)
if match:
    new_content = content[:match.start()] + replacement + '\n' + content[match.end():]
    with open(r'e:\Flight-Query-Parser\static\employees.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Replaced successfully")
else:
    print("Regex failed to match")
