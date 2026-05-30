import re

with open('static/employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix priority badges missing template tags
broken_badge = '''
             : ''}'''

fixed_badge = '''
            ${s.metadata?.isHighPriority ? '<span class="ew-priority-badge">PRIORITY</span>' : ''}'''

content = content.replace(broken_badge, fixed_badge)

# Fix broken priority toggle
broken_toggle = '''          <button type="button" class="ew-priority-toggle " title="Toggle Priority" onclick="toggleSubtaskPriority('', '')">
              
            </button>'''

fixed_toggle = '''          <button type="button" class="ew-priority-toggle ${s.metadata?.isHighPriority ? 'is-priority' : ''}" title="Toggle Priority" onclick="toggleSubtaskPriority('${s.tripId}', '${s.id}')">
            ${s.metadata?.isHighPriority ? 'PRIORITY' : 'NORMAL'}
          </button>'''

content = content.replace(broken_toggle, fixed_toggle)

with open('static/employees.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed!')
