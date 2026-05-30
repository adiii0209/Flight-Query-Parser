import json
with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '\"dueDate\": due_date.isoformat() if due_date else \"\",'
replacement = target + '\n                  \"priority\": int(item.get(\"priority\", 9999)) if item.get(\"priority\") is not None else 9999,'

if target in content:
    content = content.replace(target, replacement)
    with open('app.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS')
else:
    print('NOT FOUND')