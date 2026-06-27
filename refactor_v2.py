import re

with open('routes_v2.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace local login_required
old_login_req_pattern = r'def login_required\(f\):.*?return decorated_function\n'
content = re.sub(old_login_req_pattern, '', content, flags=re.DOTALL)

# Add import
if 'from routes.auth' not in content:
    content = content.replace('from flask import Blueprint, request, jsonify, session, current_app', 'from flask import Blueprint, request, jsonify, session, current_app\nfrom routes.auth import login_required, role_required, org_type_required, get_org_scope')

# Bulk replace user_id query scopes
# db_session.query(Model).filter(Model.user_id == session['user_id'])
content = re.sub(r'([A-Za-z0-9_]+)\.user_id\s*==\s*session(\.get\(([\'\"])user_id\3\)|\[([\'\"])user_id\4\])', r'\1.organization_id == session.get("organization_id")', content)

# db_session.query(Model).filter_by(user_id=session['user_id'])
content = re.sub(r'filter_by\(\s*user_id\s*=\s*session(\.get\(([\'\"])user_id\2\)|\[([\'\"])user_id\3\])\s*\)', r'filter_by(**get_org_scope())', content)
content = re.sub(r',\s*user_id\s*=\s*session(\.get\(([\'\"])user_id\2\)|\[([\'\"])user_id\3\])', r', **get_org_scope()', content)

with open('routes_v2.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('routes_v2.py refactored.')
