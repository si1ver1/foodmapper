from sqlalchemy import Column, Integer, String, Float, ForeignKey, Table, Text
from sqlalchemy.orm import relationship
from database import Base

# Association Table
restaurant_cuisines = Table('restaurant_cuisines', Base.metadata,
    Column('restaurant_id', Integer, ForeignKey('restaurants.id')),
    Column('cuisine_id', Integer, ForeignKey('cuisines.id'))
)

# Association Table for Groups
restaurant_groups = Table('restaurant_groups', Base.metadata,
    Column('restaurant_id', Integer, ForeignKey('restaurants.id')),
    Column('group_id', Integer, ForeignKey('groups.id'))
)

class Cuisine(Base):
    __tablename__ = "cuisines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    restaurants = relationship("Restaurant", secondary=restaurant_cuisines, back_populates="cuisines")

class Restaurant(Base):
    __tablename__ = "restaurants"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    address = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    rating = Column(Integer, nullable=True)  # 1-5, or None
    price_range = Column(String) # $, $$, $$$, $$$$
    
    # Keep cuisine_id for migration, but it's deprecated
    cuisine_id = Column(Integer, ForeignKey("cuisines.id"), nullable=True)
    
    personal_notes = Column(Text, nullable=True)
    status = Column(String) # "Want to go", "Visited", "Favorite"

    cuisines = relationship("Cuisine", secondary=restaurant_cuisines, back_populates="restaurants")
    groups = relationship("Group", secondary="restaurant_groups", back_populates="restaurants")
    
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    owner = relationship("User", back_populates="restaurants")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=True)
    oauth_provider = Column(String, nullable=True)

    groups = relationship("Group", back_populates="owner")
    restaurants = relationship("Restaurant", back_populates="owner")

class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True) # Removed unique=True to allow multiple users to have "Favorites" etc.
    share_token = Column(String, unique=True, index=True, nullable=True)
    is_published = Column("is_published", Integer, default=0) # 0=False, 1=True (SQLite boolean)
    owner_id = Column("owner_id", Integer, ForeignKey("users.id"), nullable=True) # Nullable for migration

    owner = relationship("User", back_populates="groups")
    restaurants = relationship("Restaurant", secondary=restaurant_groups, back_populates="groups")
