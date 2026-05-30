import re

with open('templates/ownership.html', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'ownership\.(js|css)\?v=[a-zA-Z0-9]+', r'ownership.\1?v=20260530priority', content)

with open('templates/ownership.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('SUCCESS')