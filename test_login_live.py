import urllib.request
try:
    req = urllib.request.Request(
        'http://localhost:5000/api/login', 
        method='POST', 
        data=b'{"username":"superadmin","password":"supersecret"}', 
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as response:
        print('Status:', response.status)
        print('Response:', response.read().decode())
except Exception as e:
    print('Error:', e)
    if hasattr(e, 'read'):
        print('Error body:', e.read().decode())
