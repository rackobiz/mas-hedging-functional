const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = process.env.DB_PATH || './database/mas_hedging.db';
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            // Ensure database directory exists
            const dbDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database');
                    this.createTables()
                        .then(() => this.seedInitialData())
                        .then(() => resolve())
                        .catch(reject);
                }
            });
        });
    }

    async createTables() {
        const tables = [
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                company TEXT,
                phone TEXT,
                role TEXT DEFAULT 'user',
                subscription_plan TEXT DEFAULT 'basic',
                is_verified BOOLEAN DEFAULT 0,
                verification_token TEXT,
                reset_token TEXT,
                reset_token_expires DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME
            )`,

            // Hedging positions table
            `CREATE TABLE IF NOT EXISTS hedging_positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                metal_type TEXT NOT NULL,
                position_type TEXT NOT NULL, -- 'long' or 'short'
                quantity REAL NOT NULL,
                entry_price REAL NOT NULL,
                current_price REAL,
                target_price REAL,
                stop_loss REAL,
                status TEXT DEFAULT 'active', -- 'active', 'closed', 'expired'
                contract_date DATE NOT NULL,
                expiry_date DATE NOT NULL,
                profit_loss REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Market data table
            `CREATE TABLE IF NOT EXISTS market_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metal_type TEXT NOT NULL,
                price REAL NOT NULL,
                change_24h REAL,
                change_percent REAL,
                volume REAL,
                market_cap REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // User sessions table
            `CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Notifications table
            `CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info', -- 'info', 'warning', 'success', 'error'
                is_read BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Trading alerts table
            `CREATE TABLE IF NOT EXISTS trading_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                metal_type TEXT NOT NULL,
                alert_type TEXT NOT NULL, -- 'price_above', 'price_below', 'volume_spike'
                target_value REAL NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                triggered_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Audit log table
            `CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                action TEXT NOT NULL,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        // Create indexes for better performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
            'CREATE INDEX IF NOT EXISTS idx_hedging_positions_user_id ON hedging_positions(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_market_data_metal_timestamp ON market_data(metal_type, timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_trading_alerts_user_id ON trading_alerts(user_id)'
        ];

        for (const index of indexes) {
            await this.run(index);
        }
    }

    async seedInitialData() {
        // Check if admin user exists
        const adminExists = await this.get('SELECT id FROM users WHERE email = ?', ['admin@mashedging.com']);
        
        if (!adminExists) {
            // Create admin user
            const hashedPassword = await bcrypt.hash('admin123!', 12);
            await this.run(`
                INSERT INTO users (email, password, first_name, last_name, company, role, subscription_plan, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'admin@mashedging.com',
                hashedPassword,
                'Admin',
                'User',
                'MAS Hedging',
                'admin',
                'enterprise',
                1
            ]);
            console.log('✅ Admin user created: admin@mashedging.com / admin123!');
        }

        // Seed initial market data
        const marketDataExists = await this.get('SELECT id FROM market_data LIMIT 1');
        
        if (!marketDataExists) {
            const initialMarketData = [
                { metal: 'copper', price: 8742.50, change: 1.24 },
                { metal: 'aluminum', price: 2450.75, change: -0.85 },
                { metal: 'zinc', price: 3120.25, change: 2.15 },
                { metal: 'nickel', price: 21875.00, change: -1.45 },
                { metal: 'lead', price: 2185.30, change: 0.75 },
                { metal: 'tin', price: 24650.00, change: 3.20 }
            ];

            for (const data of initialMarketData) {
                await this.run(`
                    INSERT INTO market_data (metal_type, price, change_percent, volume, market_cap)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    data.metal,
                    data.price,
                    data.change,
                    Math.random() * 1000000, // Random volume
                    data.price * (Math.random() * 100000 + 50000) // Random market cap
                ]);
            }
            console.log('✅ Initial market data seeded');
        }
    }

    // Promisified database methods
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    isConnected() {
        return this.db !== null;
    }

    async close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) reject(err);
                    else {
                        console.log('Database connection closed');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;
