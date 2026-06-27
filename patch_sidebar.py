import re

with open('templates/components/sidebar.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add switch workspace link under the User Handle
# We will inject a new div right after the user-handle
target = r'<div class="user-handle" id="sidebarUserHandle">Welcome to Dashboard</div>\s*</div>\s*</div>'
replacement = """<div class="user-handle" id="sidebarUserHandle">Welcome to Dashboard</div>
        <a href="/workspace" class="workspace-switch-btn" style="display:inline-block; margin-top:0.5rem; font-size:0.75rem; color:#60a5fa; text-decoration:none; border:1px solid rgba(96,165,250,0.3); padding:0.2rem 0.5rem; border-radius:4px; transition:all 0.2s ease;">⇄ Switch Workspace</a>
      </div>
    </div>
"""
content = re.sub(target, replacement, content, count=1)

with open('templates/components/sidebar.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('sidebar patched')
