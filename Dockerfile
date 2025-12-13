FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# gcc is often needed for compiling python packages usually
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set timezone
ENV TZ=Asia/Tokyo

EXPOSE 5000

CMD ["python", "app.py"]
