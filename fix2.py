import re

with open('static/employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

def repl_toggle(m):
    # m.group(1) captures the surrounding whitespace and context if needed
    # actually let's just replace the exact broken toggle block with a dynamic one based on if it's trip.id or s.tripId
    pass

# We will just replace ALL instances of the broken toggle with a generic one that uses tripId
# Wait, let's use regex to find the button just before it
content = re.sub(
    r'<button type="button" class="ew-priority-toggle " title="Toggle Priority" \s*onclick="toggleSubtaskPriority\(\'\'\, \'\'\)">\s*</button>',
    r'''<button type="button" class="ew-priority-toggle " title="Toggle Priority" onclick="toggleSubtaskPriority('', '')">
            
          </button>''',
    content
)

with open('static/employees.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Regex fixed')