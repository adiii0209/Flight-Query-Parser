import re
with open('static/employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

def repl(m):
    return '\n    if (currentView === "workspace") {\n      renderWorkspace();\n    } else {\n      replaceSubtaskCardDom(tripId, subtaskId);\n    }' + m.group(1)

new_content = re.sub(r'\n    replaceSubtaskCardDom\(tripId, subtaskId\);(.*?updateTripField)', repl, content, flags=re.DOTALL)

with open('static/employees.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
print('SUCCESS')