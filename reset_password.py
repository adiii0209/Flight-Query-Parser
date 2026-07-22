import sys
from app import app
from extensions import db
from models import User

def reset_password(username, new_password):
    with app.app_context():
        user = User.query.filter((User.username == username) | (User.email == username)).first()
        if not user:
            print(f"Error: User with username or email '{username}' not found.")
            sys.exit(1)
            
        user.set_password(new_password)
        db.session.commit()
        print(f"Success: Password for user '{user.username}' ({user.email}) has been successfully updated.")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python reset_password.py <username_or_email> <new_password>")
        sys.exit(1)
        
    username_or_email = sys.argv[1]
    new_password = sys.argv[2]
    reset_password(username_or_email, new_password)
