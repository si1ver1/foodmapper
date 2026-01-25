from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
from models import Cuisine

# Create tables
Base.metadata.create_all(bind=engine)

def seed_cuisines():
    db = SessionLocal()
    initial_cuisines = [
        "American", "Chinese", "French", "Indian", "Italian", "Japanese", 
        "Mediterranean", "Mexican", "Thai", "Vegetarian/Vegan", 
        "BBQ", "Burger", "Pizza", "Seafood", "Steakhouse"
    ]

    for cuisine_name in initial_cuisines:
        exists = db.query(Cuisine).filter(Cuisine.name == cuisine_name).first()
        if not exists:
            db.add(Cuisine(name=cuisine_name))
    
    db.commit()
    db.close()
    print("Cuisines seeded successfully!")

if __name__ == "__main__":
    seed_cuisines()
