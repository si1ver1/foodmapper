# FoodMapper 🍔🗺️

FoodMapper is a personalized restaurant tracker application that helps you organize your culinary adventures. Keep track of places you want to go, have visited, or absolutely love.

## ✨ Features

### 📍 Smart Mapping & Tracking
-   **Interactive Map**: View all your saved spots on a unified map interface (powered by Leaflet).
-   **Google Places Integration**: Search and add restaurants using Google's Autocomplete API to automatically fetch address and coordinates.
-   **Status Tracking**: Categorize spots as:
    -   blue: **Want to go**
    -   gray: **Visited**
    -   pink: **Favorite**
-   **Notes**: Add personal notes to remember what to order or why you liked a place.

### 👥 User Isolation & Security
-   **Private Workspaces**: Each user gets their own private list of restaurants and groups.
-   **Google OAuth**: seamless login with your Google account.
-   **Secure**:
    -   XSS protection for user inputs.
    -   Session timeouts to protect your data.
    -   Admin-only access to legacy data.

### 🎲 Decision Tools
-   **"Help Me Choose"**: Can't decide where to eat? Let the app pick for you based on your filters (Cuisine, Price, Rating).
-   **Filters**: Quickly sort your list by Cuisine, Price ($ to $$$$), Rating, or Group.

### 🎨 Modern UI
-   **Responsive Design**: Works great on desktop and mobile (with a dedicated bottom navigation bar).
-   **Dark Mode**: Toggle between light and midnight themes.
-   **Distance Calculation**: Shows how far away restaurants are from your current location.

## 🛠️ Tech Stack
-   **Backend**: Python (FastAPI), SQLAlchemy, SQLite
-   **Frontend**: HTML5, Vanilla JS, Tailwind CSS
-   **Maps**: Leaflet JS + OpenStreetMap, Google Maps API (Places)
-   **Auth**: Authlib (Google OAuth2), JWT

## 🚀 Getting Started (Local Dev)

1.  **Clone the repo**
2.  **Install Python Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
3.  **Install Node Dependencies** (for Tailwind):
    ```bash
    npm install
    ```
4.  **Setup Environment**:
    Create a `.env` file based on `.env_example`:
    ```env
    SECRET_KEY=your_secret
    GOOGLE_CLIENT_ID=your_id
    GOOGLE_CLIENT_SECRET=your_secret
    GOOGLE_MAPS_API_KEY=your_key
    DEBUG=True
    ```
5.  **Run the App**:
    ```bash
    # Terminal 1 (CSS Watcher)
    npm run build:css
    
    # Terminal 2 (Server)
    python main.py
    ```
6.  Visit `http://localhost:8000`

## ☁️ Deployment
This project is containerized with **Docker** and ready for deployment on platforms like **Render**, **Fly.io**, or **Railway**.
-   See `deployment_render.md` for specific instructions on deploying to Render.
