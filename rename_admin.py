from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

# Database Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./foodmapper_v2.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

try:
    # SQL to update username
    # We use text() for raw SQL to be quick, or we could use models if we imported them.
    # Raw SQL is safer here to avoid Pydantic/Model issues if they are broken.
    
    # 1. Check if 'admin' exists
    result = db.execute(text("SELECT id FROM users WHERE username = 'admin'"))
    admin_user = result.fetchone()
    
    if admin_user:
        print(f"Found user 'admin' with ID: {admin_user[0]}")
        # 2. Update to 'Adam'
        db.execute(text("UPDATE users SET username = 'Adam' WHERE username = 'admin'"))
        db.commit()
        print("Successfully renamed 'admin' to 'Adam'.")
    else:
        print("User 'admin' not found.")
        
        # Check if 'Adam' already exists
        result_adam = db.execute(text("SELECT id FROM users WHERE username = 'Adam'"))
        if result_adam.fetchone():
             print("User 'Adam' already exists.")
        else:
             print("Neither 'admin' nor 'Adam' found. No changes made.")

except Exception as e:
    print(f"Error: {e}")
    db.rollback()
finally:
    db.close()
