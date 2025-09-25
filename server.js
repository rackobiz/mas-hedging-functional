const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('./database/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new Database();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'mas-hedging-super-secure-secret-key-2024';

// Auth middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'MAS Hedging Platform Online',
        version: '2.0.0',
        features: ['Trading', 'Analytics', 'Real-time Data']
    });
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, company, password } = req.body;

        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const userId = await db.createUser({
            firstName,
            lastName,
            email,
            company: company || null,
            password: hashedPassword
        });

        const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '24h' });

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: { id: userId, firstName, lastName, email, company }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await db.getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            token,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                company: user.company
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Market data routes
app.get('/api/market/data', (req, res) => {
    const metals = ['copper', 'aluminum', 'zinc', 'nickel', 'lead', 'tin'];
    const basePrice = {
        copper: 8500,
        aluminum: 2400,
        zinc: 3000,
        nickel: 21000,
        lead: 2150,
        tin: 24500
    };

    const marketData = metals.map(metal => {
        const variation = (Math.random() - 0.5) * 0.1;
        const price = basePrice[metal] * (1 + variation);
        const change24h = (Math.random() - 0.5) * 0.06;
        
        return {
            metal: metal.toUpperCase(),
            price: parseFloat(price.toFixed(2)),
            change24h: parseFloat((change24h * 100).toFixed(2)),
            volume: Math.floor(Math.random() * 1000000) + 100000,
            timestamp: new Date().toISOString()
        };
    });

    res.json(marketData);
});

// Position routes
app.get('/api/positions', authenticateToken, async (req, res) => {
    try {
        const positions = await db.getUserPositions(req.user.userId);
        res.json(positions);
    } catch (error) {
        console.error('Get positions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/positions', authenticateToken, async (req, res) => {
    try {
        const { metal, type, quantity, entryPrice, targetPrice, stopLoss, contractDate, expiryDate } = req.body;

        if (!metal || !type || !quantity || !entryPrice) {
            return res.status(400).json({ error: 'Required fields missing' });
        }

        const positionId = await db.createPosition({
            userId: req.user.userId,
            metal,
            type,
            quantity: parseFloat(quantity),
            entryPrice: parseFloat(entryPrice),
            targetPrice: targetPrice ? parseFloat(targetPrice) : null,
            stopLoss: stopLoss ? parseFloat(stopLoss) : null,
            contractDate,
            expiryDate
        });

        res.status(201).json({
            message: 'Position created successfully',
            positionId
        });
    } catch (error) {
        console.error('Create position error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Dashboard routes
app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
    try {
        const summary = await db.getUserDashboardSummary(req.user.userId);
        res.json(summary);
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 MAS Hedging server running on port ${PORT}`);
});

module.exports = app;
