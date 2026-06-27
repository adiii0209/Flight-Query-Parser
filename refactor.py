import re

with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace login_required decorator and add imports
auth_imports = '''from routes.auth import auth_bp, login_required, role_required, org_type_required, get_org_scope
from routes.rbac import rbac_bp
'''

if 'from routes.auth' not in content:
    content = re.sub(r'(app = Flask\(__name__\)\n)', r'\1\n' + auth_imports, content, count=1)
    content = content.replace("app.register_blueprint(routes_v2_bp, url_prefix='/api/v2')", "app.register_blueprint(routes_v2_bp, url_prefix='/api/v2')\napp.register_blueprint(auth_bp)\napp.register_blueprint(rbac_bp)")

# Remove old login_required
old_login_req_pattern = r'def login_required\(f\):.*?return decorated_function\n'
content = re.sub(old_login_req_pattern, '', content, flags=re.DOTALL)

# 2. Bulk replace user_id query scopes
# filter_by(user_id=session['user_id']) -> filter_by(**get_org_scope())
content = re.sub(r'filter_by\(\s*user_id\s*=\s*session(\.get\(([\'\"])user_id\2\)|\[([\'\"])user_id\3\])\s*\)', r'filter_by(**get_org_scope())', content)
# filter_by(..., user_id=session['user_id']) -> filter_by(..., **get_org_scope())
content = re.sub(r',\s*user_id\s*=\s*session(\.get\(([\'\"])user_id\2\)|\[([\'\"])user_id\3\])', r', **get_org_scope()', content)
# filter(Model.user_id == session['user_id']) -> filter(Model.organization_id == session.get('organization_id'))
content = re.sub(r'([A-Za-z0-9_]+)\.user_id\s*==\s*session(\.get\(([\'\"])user_id\3\)|\[([\'\"])user_id\4\])', r'\1.organization_id == session.get("organization_id")', content)

# 3. Handle old login, register, logout endpoints in app.py
# Remove /api/login, /api/register, /api/logout, /api/user from app.py to avoid conflicts with auth_bp
# We will just comment out the entire functions.
endpoints_to_remove = [
    r'@app\.route\("/api/login", methods=\["POST"\]\).*?(?=@app\.route)',
    r'@app\.route\("/api/register", methods=\["POST"\]\).*?(?=@app\.route)',
    r'@app\.route\("/api/logout", methods=\["POST"\]\).*?(?=@app\.route)',
    r'@app\.route\("/api/user", methods=\["GET"\]\).*?(?=@app\.route)'
]

for pattern in endpoints_to_remove:
    content = re.sub(pattern, '', content, flags=re.DOTALL)

with open('app.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('app.py refactored.')
