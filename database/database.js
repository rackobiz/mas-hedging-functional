const sqlite3 = require('sqlite3').verbose();

class Database {
    constructor() {
        this.db = new sqlite3.Database(':memory:', (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database');
                this.initTables();
            }
        });
    }

    initTables() {
        const createTables = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                company TEXT,
                password TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                metal TEXT NOT NULL,
                type TEXT NOT NULL,
                quantity REAL NOT NULL,
                entryPrice REAL NOT NULL,
                currentPrice REAL,
                targetPrice REAL,
                stopLoss REAL,
                contractDate TEXT,
                expiryDate TEXT,
                status TEXT DEFAULT 'active',
                pnl REAL DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users (id)
            )`
        ];

        createTables.forEach(sql => {
            this.db.run(sql, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                }
            });
        });
    }

    async getUserByEmail(email) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async createUser(userData) {
        return new Promise((resolve, reject) => {
            const { firstName, lastName, email, company, password } = userData;
            this.db.run(
                'INSERT INTO users (firstName, lastName, email, company, password) VALUES (?, ?, ?, ?, ?)',
                [firstName, lastName, email, company, password],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    async getUserPositions(userId) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM positions WHERE userId = ? ORDER BY createdAt DESC', [userId], (err, rows) => {
                if (err) reject(err);
                else {
                    const updatedPositions = rows.map(position => {
                        const currentPrice = this.getCurrentPrice(position.metal);
                        const pnl = this.calculatePnL(position, currentPrice);
                        return {
                            ...position,
                            currentPrice,
                            pnl: pnl.amount,
                            pnlPercentage: pnl.percentage
                        };
                    });
                    resolve(updatedPositions);
                }
            });
        });
    }

    async createPosition(positionData) {
        return new Promise((resolve, reject) => {
            const { userId, metal, type, quantity, entryPrice, targetPrice, stopLoss, contractDate, expiryDate } = positionData;
            this.db.run(
                'INSERT INTO positions (userId, metal, type, quantity, entryPrice, targetPrice, stopLoss, contractDate, expiryDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [userId, metal, type, quantity, entryPrice, targetPrice, stopLoss, contractDate, expiryDate],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    async getUserDashboardSummary(userId) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM positions WHERE userId = ?', [userId], (err, positions) => {
                if (err) {
                    reject(err);
                } else {
                    const totalPositions = positions.length;
                    const activePositions = positions.filter(p => p.status === 'active').length;
                    
                    let totalPnL = 0;
                    let totalValue = 0;

                    positions.forEach(position => {
                        const currentPrice = this.getCurrentPrice(position.metal);
                        const pnl = this.calculatePnL(position, currentPrice);
                        totalPnL += pnl.amount;
                        totalValue += position.quantity * position.entryPrice;
                    });

                    resolve({
                        totalPositions,
                        activePositions,
                        totalPnL: parseFloat(totalPnL.toFixed(2)),
                        totalValue: parseFloat(totalValue.toFixed(2)),
                        winRate: totalPositions > 0 ? ((positions.filter(p => p.pnl > 0).length / totalPositions) * 100).toFixed(1) : 0
                    });
                }
            });
        });
    }

    getCurrentPrice(metal) {
        const basePrices = {
            'COPPER': 8500,
            'ALUMINUM': 2374,
            'ZINC': 3017,
            'NICKEL': 21218,
            'LEAD': 2151,
            'TIN': 24605
        };

        const basePrice = basePrices[metal.toUpperCase()] || 1000;
        const variation = (Math.random() - 0.5) * 0.1;
        return parseFloat((basePrice * (1 + variation)).toFixed(2));
    }

    calculatePnL(position, currentPrice) {
        const entryValue = position.quantity * position.entryPrice;
        const currentValue = position.quantity * currentPrice;
        
        let pnlAmount;
        if (position.type === 'long') {
            pnlAmount = currentValue - entryValue;
        } else {
            pnlAmount = entryValue - currentValue;
        }

        const pnlPercentage = (pnlAmount / entryValue) * 100;

        return {
            amount: parseFloat(pnlAmount.toFixed(2)),
            percentage: parseFloat(pnlPercentage.toFixed(2))
        };
    }
}

module.exports = Database;
