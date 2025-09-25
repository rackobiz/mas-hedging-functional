const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import custom modules
const Database = require('./database/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const hedgingRoutes = require('./routes/hedging');
const marketRoutes = require('./routes/market');
const dashboardRoutes = require('./routes/dashboard');
const { authenticateToken } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new Database();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "https:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX), // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000',
    credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Static files
app.use(express.static('public'));

// Make database available to routes
app.use((req, res, next) => {
    req.db = db;
    next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/hedging', authenticateToken, hedgingRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);

// Serve main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'MAS Hedging functional platform is running',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
    });
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        status: 'operational',
        database: db.isConnected() ? 'connected' : 'disconnected',
        features: {
            authentication: true,
            realTimeData: process.env.ENABLE_REAL_DATA === 'true',
            notifications: process.env.ENABLE_NOTIFICATIONS === 'true',
            analytics: process.env.ENABLE_ANALYTICS === 'true'
        },
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize database and start server
async function startServer() {
    try {
        await db.initialize();
        console.log('✅ Database initialized successfully');
        
        app.listen(PORT, () => {
            console.log(`🚀 MAS Hedging Functional Platform running on port ${PORT}`);
            console.log(`📱 Local: http://localhost:${PORT}`);
            console.log(`🔒 Environment: ${process.env.NODE_ENV}`);
            console.log(`💾 Database: ${process.env.DB_PATH}`);
            console.log(`⚡ Features enabled: Real-time data, Authentication, Dashboard`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 Received SIGTERM, shutting down gracefully...');
    await db.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Received SIGINT, shutting down gracefully...');
    await db.close();
    process.exit(0);
});

startServer();
