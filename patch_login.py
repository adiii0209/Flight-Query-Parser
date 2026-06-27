import re

with open('templates/login.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove Test User button
content = re.sub(r'<div class="divider">or</div>\s*<button class="btn-ghost" onclick="loginTestUser\(\)">🧪 Continue as Test User</button>', '', content)

# 2. Update Login handler to handle workspace redirect
new_login_logic = """
        if (res.ok) {
          if (data.requires_workspace_selection) {
            window.location.href = '/workspace';
          } else {
            showNotif('Welcome back! Redirecting…', 'success');
            const next = new URLSearchParams(window.location.search).get('next') || '/';
            setTimeout(() => window.location.href = next, 900);
          }
        }
"""
content = re.sub(r'if \(res\.ok\) \{\s*showNotif\(\'Welcome back! Redirecting…\', \'success\'\);\s*const next = new URLSearchParams\(window\.location\.search\)\.get\(\'next\'\) \|\| \'/\';\s*setTimeout\(\(\) => window\.location\.href = next, 900\);\s*\}', new_login_logic.strip(), content)

# 3. Remove loginTestUser function
content = re.sub(r'/\* ── TEST USER ──────────────────────────────────────── \*/.*?async function loginTestUser\(\) \{.*?\}\s*(?=\/\* ── ENTER KEY)', '', content, flags=re.DOTALL)

# 4. Modify Registration form to support Agency / Individual
old_register_panel = r'<!-- REGISTER -->.*?</div>\s*</div>\s*</div>'
new_register_panel = """
      <!-- REGISTER -->
      <div class="form-panel hidden" id="panel-register">
        <div class="tabs" style="margin-bottom: 1rem;">
          <button class="tab active" id="tab-reg-agency" onclick="switchRegTab('agency')">Agency</button>
          <button class="tab" id="tab-reg-indiv" onclick="switchRegTab('indiv')">Individual</button>
        </div>
        
        <div id="reg-agency-fields">
          <div class="form-group">
            <label class="form-label">Agency Name</label>
            <div class="input-wrap">
              <span class="input-icon">🏢</span>
              <input class="form-input" type="text" id="regAgencyName" placeholder="Your Agency">
            </div>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <div class="input-wrap">
            <span class="input-icon">✨</span>
            <input class="form-input" type="text" id="regFullName" placeholder="Jane Smith">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <div class="input-wrap">
            <span class="input-icon">📧</span>
            <input class="form-input" type="email" id="regEmail" placeholder="you@example.com" autocomplete="email">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Username</label>
          <div class="input-wrap">
            <span class="input-icon">👤</span>
            <input class="form-input" type="text" id="regUsername" placeholder="cool_handle" autocomplete="username">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div class="input-wrap">
            <span class="input-icon">🔒</span>
            <input class="form-input" type="password" id="regPassword" placeholder="••••••••" autocomplete="new-password" style="padding-right:2.8rem">
            <button class="eye-btn" type="button" onclick="toggleVis('regPassword',this)">👁️</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <div class="input-wrap">
            <span class="input-icon">🔐</span>
            <input class="form-input" type="password" id="regConfirm" placeholder="••••••••" autocomplete="new-password" style="padding-right:2.8rem">
            <button class="eye-btn" type="button" onclick="toggleVis('regConfirm',this)">👁️</button>
          </div>
        </div>
        <button class="btn-primary" id="registerBtn" onclick="handleRegister()">Create Account</button>
      </div>
    </div>
  </div>
"""
content = re.sub(old_register_panel, new_register_panel.strip(), content, flags=re.DOTALL)

# 5. Modify handleRegister function to use the selected type
old_handle_register = r'async function handleRegister\(\) \{.*?\}\s*(?=\/\* ── TEST)'
if '/* ── TEST' not in content:
    # If TEST USER block is already removed
    old_handle_register = r'async function handleRegister\(\) \{.*?\}\s*(?=\/\* ── ENTER KEY)'

new_handle_register = """
    let regType = 'agency';
    function switchRegTab(type) {
      regType = type;
      document.getElementById('tab-reg-agency').classList.toggle('active', type === 'agency');
      document.getElementById('tab-reg-indiv').classList.toggle('active', type === 'indiv');
      document.getElementById('reg-agency-fields').style.display = type === 'agency' ? 'block' : 'none';
    }

    async function handleRegister() {
      const fullName = document.getElementById('regFullName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const username = document.getElementById('regUsername').value.trim();
      const password = document.getElementById('regPassword').value;
      const confirm = document.getElementById('regConfirm').value;
      const agencyName = document.getElementById('regAgencyName') ? document.getElementById('regAgencyName').value.trim() : '';

      if (!fullName || !email || !username || !password || (regType === 'agency' && !agencyName)) { 
        showNotif('Please fill in all fields', 'error'); return; 
      }
      if (password !== confirm) { showNotif('Passwords do not match', 'error'); return; }
      
      setLoading('registerBtn', true, 'Creating account…');
      clearNotif();
      try {
        const endpoint = regType === 'agency' ? '/api/register/agency' : '/api/register/individual';
        const payload = { full_name: fullName, email, username, password };
        if (regType === 'agency') payload.agency_name = agencyName;

        const res = await fetch(endpoint, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(payload) 
        });
        const data = await res.json();
        if (res.ok) {
          showNotif('Account created! Redirecting…', 'success');
          setTimeout(() => window.location.href = '/workspace', 900);
        } else {
          showNotif(data.error || 'Registration failed', 'error');
          setLoading('registerBtn', false, 'Create Account');
        }
      } catch (e) { showNotif('Network error — try again', 'error'); setLoading('registerBtn', false, 'Create Account'); }
    }
"""
content = re.sub(old_handle_register, new_handle_register.strip() + '\n\n', content, flags=re.DOTALL)

with open('templates/login.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('login.html patched.')
