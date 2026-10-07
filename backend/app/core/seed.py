"""Implementation file: app/core/seed.py"""
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import User, PlatformRole

def seed_initial_users():
    db: Session = SessionLocal()
    try:
        # Check if any Super Admin exists
        super_admin = db.query(User).filter(User.role == PlatformRole.SUPER_ADMIN).first()
        if not super_admin:
            print("Seeding default Super Admin...")
            admin_user = User(
                email="superadmin@boldandwise.com",
                hashed_password=get_password_hash("AdminPassword123!"),
                full_name="Super Administrator",
                role=PlatformRole.SUPER_ADMIN,
                status="ACTIVE"
            )
            db.add(admin_user)
            db.commit()
            print("Super Admin created successfully!")
        else:
            print("Super Admin already exists. Skipping seed.")
    except Exception as e:
        print(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_initial_users()