import re
with open('static/employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

broken_str = """          <button type="button" class="ew-priority-toggle " title="Toggle Priority" onclick="toggleSubtaskPriority('', '')">
              
            </button>"""

fixed_str = """          <button type="button" class="ew-priority-toggle ${s.metadata?.isHighPriority ? 'is-priority' : ''}" title="Toggle Priority" onclick="toggleSubtaskPriority('${s.tripId || trip.id}', '${s.id}')">
            ${s.metadata?.isHighPriority ? 'PRIORITY' : 'NORMAL'}
          </button>"""

if broken_str in content:
    content = content.replace(broken_str, fixed_str)
else:
    print("Not found! Replacing via regex...")
    content = re.sub(
        r'<button type="button" class="ew-priority-toggle " title="Toggle Priority" \s*onclick="toggleSubtaskPriority\(\'\'\, \'\'\)">\s*</button>',
        fixed_str,
        content
    )

with open('static/employees.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
