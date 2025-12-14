CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS tracked_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL UNIQUE,
    item_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS price_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    timestamp INT NOT NULL,
    bazaar_min INT DEFAULT NULL,
    bazaar_avg FLOAT DEFAULT NULL,
    market_min INT DEFAULT NULL,
    market_avg FLOAT DEFAULT NULL,
    FOREIGN KEY (item_id) REFERENCES tracked_items(item_id)
);
