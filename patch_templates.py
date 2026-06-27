import os
import re

for root, dirs, files in os.walk('templates'):
    for f in files:
        if f.endswith('.html'):
            filepath = os.path.join(root, f)
            with open(filepath, 'r', encoding='utf-8') as file:
                content = file.read()
                
            target = r'if \(handleEl\) handleEl\.textContent = u\.username \? \'@\' \+ u\.username : \'\';'
            replacement = """if (handleEl) {
                    const org = u.org_name ? String(u.org_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
                    const uname = u.username ? String(u.username).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
                    handleEl.innerHTML = org ? org + '<br><small style=\"opacity:0.7\">@' + uname + '</small>' : '@' + uname;
                }"""
            
            if re.search(target, content):
                new_content = re.sub(target, replacement, content)
                with open(filepath, 'w', encoding='utf-8') as file:
                    file.write(new_content)
                print(f'Patched JS in {filepath}')
