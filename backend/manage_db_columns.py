
import os
import pymysql
import re
# from dotenv import load_dotenv # Not needed in container if env passed

# load_dotenv()

def parse_db_url(url):
    # Example: mysql+asyncmy://torn:torn@db:3306/torn_tracker
    pattern = r"mysql\+[^:]+://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)"
    match = re.match(pattern, url)
    if match:
        return {
            "user": match.group(1),
            "password": match.group(2),
            "host": match.group(3),
            "port": int(match.group(4)),
            "database": match.group(5)
        }
    return None

def add_columns():
    db_url = os.getenv("DATABASE_URL")
    config = None
    
    if db_url:
        print(f"Found DATABASE_URL, parsing...")
        config = parse_db_url(db_url)
    
    if not config:
        print("Using fallback env vars")
        config = {
            "host": os.getenv("DB_HOST", "db"),
            "user": os.getenv("DB_USER", "torn"),
            "password": os.getenv("DB_PASSWORD", "torn"),
            "database": os.getenv("DB_NAME", "torn_tracker"),
            "port": int(os.getenv("DB_PORT", 3306))
        }

    print(f"Connecting to {config['host']} as {config['user']}...")

    try:
        connection = pymysql.connect(
            host=config['host'],
            user=config['user'],
            password=config['password'],
            database=config['database'],
            port=config['port'],
            cursorclass=pymysql.cursors.DictCursor
        )
        
        print("Connected to database")
        
        with connection.cursor() as cursor:
            # Check if columns exist in items table
            cursor.execute("SHOW COLUMNS FROM items LIKE 'last_market_price_avg'")
            if not cursor.fetchone():
                print("Adding last_market_price_avg to items...")
                cursor.execute("ALTER TABLE items ADD COLUMN last_market_price_avg BIGINT NULL")
            
            cursor.execute("SHOW COLUMNS FROM items LIKE 'last_bazaar_price_avg'")
            if not cursor.fetchone():
                print("Adding last_bazaar_price_avg to items...")
                cursor.execute("ALTER TABLE items ADD COLUMN last_bazaar_price_avg BIGINT NULL")
                
            # Check if columns exist in price_logs table
            cursor.execute("SHOW COLUMNS FROM price_logs LIKE 'market_price_avg'")
            if not cursor.fetchone():
                print("Adding market_price_avg to price_logs...")
                cursor.execute("ALTER TABLE price_logs ADD COLUMN market_price_avg BIGINT NULL")

            cursor.execute("SHOW COLUMNS FROM price_logs LIKE 'bazaar_price_avg'")
            if not cursor.fetchone():
                print("Adding bazaar_price_avg to price_logs...")
                cursor.execute("ALTER TABLE price_logs ADD COLUMN bazaar_price_avg BIGINT NULL")

            # Check for failure_count in items
            cursor.execute("SHOW COLUMNS FROM items LIKE 'failure_count'")
            if not cursor.fetchone():
                print("Adding failure_count to items...")
                cursor.execute("ALTER TABLE items ADD COLUMN failure_count INT DEFAULT 0")

        connection.commit()
        print("Schema update completed successfully.")
        
    except Exception as e:
        print(f"Error updating schema: {e}")
    finally:
        if 'connection' in locals() and connection.open:
            connection.close()

if __name__ == "__main__":
    add_columns()
