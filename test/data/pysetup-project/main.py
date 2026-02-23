import requests
import json
from datetime import datetime

def fetch_data(url):
    """Fetch data from a URL using requests library"""
    response = requests.get(url)
    return response.json()

def process_data(data):
    """Process data with datetime"""
    timestamp = datetime.now()
    return {
        "timestamp": timestamp.isoformat(),
        "data": data
    }

if __name__ == "__main__":
    data = fetch_data("https://api.example.com/data")
    result = process_data(data)
    print(json.dumps(result, indent=2))
