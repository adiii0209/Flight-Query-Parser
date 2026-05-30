with open('static/employees.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("${s.tripId || trip.id}", "${s.tripId || (typeof trip !== 'undefined' ? trip.id : '')}")

with open('static/employees.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('SUCCESS')