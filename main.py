from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from pydantic import BaseModel
import models
from database import engine, get_db
import os
from dotenv import load_dotenv
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import JWTError, jwt
import uuid

load_dotenv()

# --- Auth Configuration ---
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    # Fail secure
    # For dev convenience we can keep a fallback BUT print a HUGE warning
    print("WARNING: SECRET_KEY not set. Using insecure default. DO NOT USE IN PRODUCTION.")
    SECRET_KEY = "super_secret_dev_key_123"

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 # Reduced from 30 days

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/token")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_optional_user(token: Optional[str] = None, db: Session = Depends(get_db)):
    # Helper for routes that might allow access but behave differently (e.g., public share vs admin view)
    # Note: OAuth2PasswordBearer(auto_error=False) would be cleaner but let's keep it simple for now
    if not token:
        return None
    try:
        # We manually check the header if we wanted to support optional auth on the SAME endpoint
        # But usually we separate public/private endpoints.
        # For this app, we will use separate logic.
        pass
    except:
        return None
    return None

# Create Tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# --- Startup Logic ---
def create_default_admin():
    db = next(get_db())
    try:
        admin = db.query(models.User).filter(models.User.username == "admin").first()
        if not admin:
            print("Creating default admin user...")
            # Use the secure password requested by user
            hashed_pw = get_password_hash("!2Nq!*iI$g5DDAGCTa")
            new_admin = models.User(username="admin", hashed_password=hashed_pw)
            db.add(new_admin)
            db.commit()
            print("Default admin created.")
    except Exception as e:
        print(f"Error creating admin: {e}")
    finally:
        db.close()

# Invoke startup
create_default_admin()

@app.get("/api/config")
def get_config():
    return {"googleMapsApiKey": os.getenv("GOOGLE_MAPS_API_KEY")}

@app.post("/api/token")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# --- Google OAuth ---
import os
# Allow OAuth over HTTP for development ONLY if explicit
if os.getenv("DEBUG") == "True":
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from authlib.integrations.starlette_client import OAuth

# Add SessionMiddleware for Authlib
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, https_only=False, same_site='lax')

oauth = OAuth()
oauth.register(
    name='google',
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile'
    }
)

@app.get("/login/google")
async def login_google(request: Request):
    # Force use of 127.0.0.1 if that is what we are using, or respect host
    redirect_uri = request.url_for('auth_google_callback')
    return await oauth.google.authorize_redirect(request, redirect_uri, prompt='select_account')

@app.get("/auth/google/callback")
async def auth_google_callback(request: Request, db: Session = Depends(get_db)):
    print("\n--- Callback Received ---", flush=True)
    try:
        print("Processing token...", flush=True)
        token = await oauth.google.authorize_access_token(request)
        print(f"Token received Keys: {token.keys()}", flush=True)
        
        user_info = token.get('userinfo')
        if not user_info:
             print("Fetching userinfo manually...", flush=True)
             user_info = await oauth.google.post('https://www.googleapis.com/oauth2/v3/userinfo', token=token)
             user_info = user_info.json()
             
        print(f"User info: {user_info}", flush=True)
        email = user_info.get('email')
        
        if not email:
            raise HTTPException(status_code=400, detail="No email provided by Google")

        user = db.query(models.User).filter(models.User.email == email).first()
        
        if not user:
            print(f"Creating new user for {email}", flush=True)
            # Create new user
            base_username = email.split('@')[0]
            username = base_username
            counter = 1
            while db.query(models.User).filter(models.User.username == username).first():
                username = f"{base_username}{counter}"
                counter += 1
            
            user = models.User(
                username=username,
                email=email,
                oauth_provider="google",
                hashed_password=None 
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user.username}, expires_delta=access_token_expires
        )
        
        response = RedirectResponse(f"/#access_token={access_token}")
        return response

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"OAuth Error: {e}", flush=True)
        raise HTTPException(status_code=400, detail=f"DEBUG_ERR: {str(e)}")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.png")

@app.get("/favicon.png", include_in_schema=False)
async def favicon_png():
    return FileResponse("static/favicon.png")

# --- Migration Logic ---
# Run once on startup to migrate single-cuisine data to multi-cuisine table
def migrate_data():
    db = next(get_db())
    try:
        # Check if restaurant_cuisines is empty
        conn = db.connection()
        # Using text() for raw SQL check or just ORM if simpler. ORM is safer.
        # But association table isn't a mapped class directly available easily in this setup without a model.
        # Let's use direct SQL to check count of the association table
        result = db.execute(text("SELECT count(*) FROM restaurant_cuisines"))
        count = result.scalar()
        
        if count == 0:
            print("Migrating data: Populating restaurant_cuisines from legacy cuisine_id...")
            restaurants = db.query(models.Restaurant).all()
            migrated = 0
            for r in restaurants:
                if r.cuisine_id:
                    # Find cuisine
                    c = db.query(models.Cuisine).filter(models.Cuisine.id == r.cuisine_id).first()
                    if c:
                        r.cuisines.append(c)
                        migrated += 1
            db.commit()
            print(f"Migration complete: Updated {migrated} restaurants.")
    except Exception as e:
        print(f"Migration warning: {e}")
    finally:
        db.close()

# Invoke migration
migrate_data()

# --- Pydantic Schemas ---
class CuisineBase(BaseModel):
    name: str

class CuisineCreate(CuisineBase):
    pass

class Cuisine(CuisineBase):
    id: int
    class Config:
        from_attributes = True

class GroupBase(BaseModel):
    name: str

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    class Config:
        from_attributes = True

class RestaurantBase(BaseModel):
    name: str
    address: str
    latitude: float
    longitude: float
    rating: Optional[int] = None
    price_range: str
    # cuisine_id: int  <-- Deprecated in input, replaced by list
    cuisine_ids: List[int]
    group_ids: List[int] = [] 
    personal_notes: Optional[str] = None
    status: str

class RestaurantCreate(RestaurantBase):
    pass

class Restaurant(BaseModel): # Redefining to flatten structure
    id: int
    name: str
    address: str
    latitude: float
    longitude: float
    rating: Optional[int] = None
    price_range: str
    personal_notes: Optional[str] = None
    status: str
    cuisines: List[Cuisine] # <--- Changed from single 'cuisine'
    groups: List[Group] = []

    class Config:
        from_attributes = True

# --- API Routes ---

@app.post("/api/cuisines", response_model=Cuisine)
def create_cuisine(cuisine: CuisineCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_cuisine = db.query(models.Cuisine).filter(models.Cuisine.name == cuisine.name).first()
    if db_cuisine:
        return db_cuisine
    new_cuisine = models.Cuisine(name=cuisine.name)
    db.add(new_cuisine)
    db.commit()
    db.refresh(new_cuisine)
    return new_cuisine

@app.get("/api/cuisines", response_model=List[Cuisine])
def read_cuisines(db: Session = Depends(get_db)):
    # Cuisines can be public for now, or protected. Let's keep public metadata public.
    return db.query(models.Cuisine).all()

@app.delete("/api/cuisines/{cuisine_id}")
def delete_cuisine(cuisine_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.query(models.Cuisine).filter(models.Cuisine.id == cuisine_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cuisine not found")

    if len(c.restaurants) > 0:
        raise HTTPException(status_code=400, detail="Cannot delete cuisine that is being used by restaurants.")

    db.delete(c)
    db.commit()
    return {"ok": True}

@app.post("/api/groups", response_model=Group)
def create_group(group: GroupCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Check if exists for this user (or global if we want simple unique names)
    db_group = db.query(models.Group).filter(models.Group.name == group.name).first()
    if db_group:
       raise HTTPException(status_code=400, detail="Group already exists")
    
    new_group = models.Group(name=group.name, owner_id=current_user.id)
    db.add(new_group)
    db.commit()
    db.refresh(new_group)
    return new_group

@app.get("/api/groups", response_model=List[Group])
def read_groups(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.Group).filter(models.Group.owner_id == current_user.id).all()

@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(g)
    db.commit()
    return {"ok": True}

@app.post("/api/groups/{group_id}/share")
def share_group(group_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not g:
         raise HTTPException(status_code=404, detail="Group not found")
    
    if g.share_token:
        return {"share_token": g.share_token}
    
    token = str(uuid.uuid4())
    g.share_token = token
    db.commit()
    return {"share_token": token}

@app.get("/api/share/{token}", response_model=List[Restaurant])
def view_shared_group(token: str, db: Session = Depends(get_db)):
    group = db.query(models.Group).filter(models.Group.share_token == token).first()
    if not group:
         raise HTTPException(status_code=404, detail="Shared group not found")
    
    # Return restaurants in this group
    return group.restaurants

@app.post("/api/restaurants", response_model=Restaurant)
def create_restaurant(r: RestaurantCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_rest = models.Restaurant(
        name=r.name,
        address=r.address,
        latitude=r.latitude,
        longitude=r.longitude,
        rating=r.rating,
        price_range=r.price_range,
        personal_notes=r.personal_notes,
        status=r.status,
        owner_id=current_user.id # Set Owner
    )
    
    # Add cuisines
    if r.cuisine_ids:
        cuisines = db.query(models.Cuisine).filter(models.Cuisine.id.in_(r.cuisine_ids)).all()
        db_rest.cuisines = cuisines

    # Add groups
    if r.group_ids:
        # Verify groups belong to user
        groups = db.query(models.Group).filter(models.Group.id.in_(r.group_ids), models.Group.owner_id == current_user.id).all()
        db_rest.groups = groups

    db.add(db_rest)
    db.commit()
    db.refresh(db_rest)
    return db_rest

@app.get("/api/restaurants", response_model=List[Restaurant])
def read_restaurants(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.Restaurant).filter(models.Restaurant.owner_id == current_user.id).all()

@app.put("/api/restaurants/{restaurant_id}", response_model=Restaurant)
def update_restaurant(restaurant_id: int, restaurant: RestaurantCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_restaurant = db.query(models.Restaurant).filter(models.Restaurant.id == restaurant_id, models.Restaurant.owner_id == current_user.id).first()
    if not db_restaurant:
        # Verify if it exists at all to give better error?? No, standard 404 is safer for privacy.
        raise HTTPException(status_code=404, detail="Restaurant not found")
    
    # Update scalar fields
    data = restaurant.dict(exclude={'cuisine_ids', 'group_ids'})
    for key, value in data.items():
        setattr(db_restaurant, key, value)
    
    # Update Cuisines
    # clear existing
    db_restaurant.cuisines = [] 
    if restaurant.cuisine_ids:
        clist = db.query(models.Cuisine).filter(models.Cuisine.id.in_(restaurant.cuisine_ids)).all()
        db_restaurant.cuisines.extend(clist)
        # Update legacy
        if clist:
            db_restaurant.cuisine_id = clist[0].id
        else:
            db_restaurant.cuisine_id = None
            
    # Update Groups
    db_restaurant.groups = []
    if restaurant.group_ids:
        glist = db.query(models.Group).filter(models.Group.id.in_(restaurant.group_ids), models.Group.owner_id == current_user.id).all()
        db_restaurant.groups.extend(glist)
    
    db.commit()
    db.refresh(db_restaurant)
    return db_restaurant

@app.delete("/api/restaurants/{restaurant_id}")
def delete_restaurant(restaurant_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_restaurant = db.query(models.Restaurant).filter(models.Restaurant.id == restaurant_id, models.Restaurant.owner_id == current_user.id).first()
    if not db_restaurant:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    
    db.delete(db_restaurant)
    db.commit()
    return {"ok": True}

# Serve Static Files (Frontend)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse("static/index.html")

@app.get("/share/{token}")
async def read_share_index(token: str):
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    # Use 0.0.0.0 for cloud deployment to accept external connections
    # Use PORT env variable provided by Render (default 8000 for local)
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
