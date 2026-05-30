import re

with open('static/employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add toggleSubtaskPriority function
if 'async function toggleSubtaskPriority' not in content:
    func = '''async function toggleSubtaskPriority(tripId, subtaskId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  let subsObj = trip.subtasks || {};
  let found = false;
  Object.values(subsObj).forEach(arr => {
    if (Array.isArray(arr)) {
      const s = arr.find(x => x.id === subtaskId);
      if (s) {
        if (!s.metadata) s.metadata = {};
        s.metadata.isHighPriority = !s.metadata.isHighPriority;
        found = true;
      }
    }
  });
  if (found) {
    trip.subtasks = subsObj;
    replaceSubtaskCardDom(tripId, subtaskId);
    if (currentDetailContext && currentDetailContext.tripId === tripId) {
      refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
    }
    updateTripField(tripId, 'subtasks', subsObj).catch(() => {});
  }
}

'''
    content = content.replace('async function toggleSubtaskDone', func + 'async function toggleSubtaskDone')

# Update template strings (both buildSubtaskCardHtml and renderSubtasks)
def repl_meta(m):
    return m.group(1) + '''
            ''' + m.group(2)
content = re.sub(r'(\$\{catLabel \? <span>\[\$\{escHtml\(catLabel\)\}\]</span> : \'\'\}\s*</div>\s*</div>)(.*?<div class="ew-subtask-card-badges">)', repl_meta, content, flags=re.DOTALL)

def repl_compose(m):
    return m.group(1) + '''
          <button type="button" class="ew-priority-toggle " title="Toggle Priority" onclick="toggleSubtaskPriority('', '')">
            
          </button>''' + m.group(2)
content = re.sub(r'(aria-hidden="true">\s*<path d="M22 2L11 13"></path>\s*<path d="M22 2L15 22 11 13 2 9 22 2Z"></path>\s*</svg>\s*</button>)(.*?<button class="crm-btn crm-btn-ghost")', repl_compose, content, flags=re.DOTALL)

with open('static/employees.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('SUCCESS')