# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Install Node.js and npm (required for Tailwind CSS build)
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies (if package.json exists)
RUN if [ -f package.json ]; then npm install; fi

# Build CSS once during build time (so we don't need to watch in prod)
RUN npm run build

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Run the application
CMD ["python", "main.py"]
