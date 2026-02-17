from database import SessionLocal
import models
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

def update_admin_password():
    new_password = "HkkymM%mlgyJHB25im"
    db = SessionLocal()
    try:
        admin = db.query(models.User).filter(models.User.username == "admin").first()
        if admin:
            hashed_pw = pwd_context.hash(new_password)
            admin.hashed_password = hashed_pw
            db.commit()
            print("Admin password updated successfully.")
        else:
            print("Admin user not found. It will be created on next startup with the env var.")
    except Exception as e:
        print(f"Error updating password: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    update_admin_password()
