import re

with open('templates/employees.html', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'employees\.(js|css)\?v=[a-zA-Z0-9]+', r'employees.\1?v=20260530priority', content)

with open('templates/employees.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('SUCCESS')