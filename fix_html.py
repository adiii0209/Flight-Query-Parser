import re

with open('static/ownership.js', 'r', encoding='utf-8') as f:
    content = f.read()

broken_str = "return `<div class=\"crm-status-cell\"><span class=\"crm-badge ${status}\" data-field=\"${statusField}\" onclick=\"openBadgeMenu(this, event)\" ondblclick=\"openSubtaskModal(event, '${trip.id}', '${subtaskKey}')\">${STATUS_LABELS[status] || 'Not Started'}</span>${countBadge}</div>`;"

fixed_str = "return `<div class=\"crm-status-cell\"><div style=\"position: relative; display: inline-flex; align-items: center; justify-content: center;\"><span class=\"crm-badge ${status}\" data-field=\"${statusField}\" onclick=\"openBadgeMenu(this, event)\" ondblclick=\"openSubtaskModal(event, '${trip.id}', '${subtaskKey}')\">${STATUS_LABELS[status] || 'Not Started'}</span>${countBadge}</div></div>`;"

if broken_str in content:
    content = content.replace(broken_str, fixed_str)
    with open('static/ownership.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS")
else:
    print("NOT FOUND")