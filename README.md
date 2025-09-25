# MAS Hedging - Functional Platform

A fully functional non-ferrous metals hedging platform with real user authentication, database integration, and comprehensive trading features.

## 🚀 Features

### ✅ **Complete Backend System**
- **SQLite Database** with comprehensive schema
- **JWT Authentication** with secure token management
- **RESTful API** with full CRUD operations
- **Real-time Market Data** simulation and updates
- **Advanced Analytics** and reporting
- **Risk Management** tools and metrics

### ✅ **User Management**
- **User Registration & Login** with validation
- **Profile Management** with company information
- **Password Reset** functionality
- **Role-based Access Control** (User/Admin)
- **Subscription Plans** (Basic/Pro/Enterprise)

### ✅ **Trading Features**
- **Position Management** (Create, Update, Close)
- **Real-time P&L Calculation**
- **Stop Loss & Target Price** settings
- **Portfolio Analytics** and performance tracking
- **Risk Metrics** and exposure analysis
- **Trading Alerts** and notifications

### ✅ **Market Data**
- **Live Price Feeds** for 6 metals (Copper, Aluminum, Zinc, Nickel, Lead, Tin)
- **Historical Data** with multiple timeframes
- **Market Summary** and statistics
- **Price Change Tracking** with percentage calculations
- **Volume and Market Cap** data

### ✅ **Interactive Dashboard**
- **Portfolio Overview** with key metrics
- **Performance Charts** using Chart.js
- **Risk Distribution** visualization
- **Recent Activity** feed
- **Market Alerts** and notifications

## 🛠 Technology Stack

### Backend
- **Node.js** with Express.js framework
- **SQLite** database with comprehensive schema
- **JWT** for authentication
- **bcryptjs** for password hashing
- **Helmet** for security headers
- **Rate Limiting** for API protection

### Frontend
- **Vanilla JavaScript** with modern ES6+ features
- **Tailwind CSS** for responsive design
- **Chart.js** for data visualization
- **Vanta.js** for animated backgrounds
- **Glass morphism** design effects

### Security
- **Password Hashing** with bcrypt
- **JWT Token** authentication
- **Input Validation** and sanitization
- **SQL Injection** protection
- **Rate Limiting** on API endpoints
- **CORS** configuration

## 📊 Database Schema

### Users Table
- User authentication and profile information
- Subscription plan management
- Email verification system

### Hedging Positions Table
- Complete position tracking
- P&L calculations
- Risk management fields

### Market Data Table
- Real-time price storage
- Historical data retention
- Volume and market cap tracking

### Notifications & Alerts
- User notification system
- Trading alert management
- Audit logging

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/verify-email` - Email verification
- `POST /api/auth/forgot-password` - Password reset request
- `POST /api/auth/reset-password` - Password reset

### User Management
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `PUT /api/users/change-password` - Change password
- `GET /api/users/notifications` - Get notifications
- `GET /api/users/alerts` - Get trading alerts

### Hedging Operations
- `GET /api/hedging/positions` - Get user positions
- `POST /api/hedging/positions` - Create new position
- `PUT /api/hedging/positions/:id` - Update position
- `POST /api/hedging/positions/:id/close` - Close position
- `GET /api/hedging/analytics` - Get performance analytics
- `GET /api/hedging/recommendations` - Get trading recommendations

### Market Data
- `GET /api/market/data` - Get current market data
- `GET /api/market/history/:metal` - Get historical data
- `GET /api/market/summary` - Get market summary
- `GET /api/market/price/:metal` - Get specific metal price

### Dashboard
- `GET /api/dashboard/overview` - Dashboard overview
- `GET /api/dashboard/performance` - Performance charts
- `GET /api/dashboard/risk-metrics` - Risk analysis
- `GET /api/dashboard/alerts` - Alerts and notifications
- `GET /api/dashboard/market-overview` - Market overview

## 🎯 Key Functionalities

### 1. **User Registration & Authentication**
- Complete signup flow with validation
- Secure login with JWT tokens
- Password reset functionality
- Email verification system

### 2. **Position Management**
- Create long/short positions for any metal
- Set target prices and stop losses
- Real-time P&L calculation
- Position closing with final P&L

### 3. **Real-time Market Data**
- Live price updates every 30 seconds
- Simulated market movements (±2% realistic changes)
- Volume and market cap calculations
- Historical data tracking

### 4. **Analytics & Reporting**
- Portfolio performance tracking
- Win rate calculations
- Risk distribution analysis
- Metal exposure breakdown

### 5. **Risk Management**
- Position limits based on subscription
- Concentration risk monitoring
- Value at Risk (VaR) calculations
- Portfolio beta analysis

## 🔐 Default Admin Account

**Email:** admin@mashedging.com  
**Password:** admin123!

## 🚀 Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```

3. **Access the Platform**
   - Open http://localhost:3000
   - Register a new account or use admin credentials
   - Start creating positions and exploring features

## 📈 Demo Data

The platform automatically seeds with:
- **6 Metal Types** with realistic pricing
- **Admin User** for testing
- **Initial Market Data** with simulated prices
- **Sample Notifications** and alerts

## 🔄 Real-time Features

- **Market Data Updates** every 30 seconds
- **Live P&L Calculations** on position changes
- **Automatic Alerts** when price targets are hit
- **Real-time Notifications** for important events

## 🎨 UI/UX Features

- **Responsive Design** works on all devices
- **Glass Morphism** effects for modern look
- **Animated Background** with Vanta.js
- **Interactive Charts** with Chart.js
- **Smooth Transitions** and hover effects
- **Professional Color Scheme** with proper contrast

## 🛡️ Security Features

- **Password Hashing** with bcrypt (12 rounds)
- **JWT Token** authentication with expiration
- **Input Validation** on all forms
- **SQL Injection** protection
- **Rate Limiting** (100 requests per 15 minutes)
- **Secure Headers** with Helmet.js

This is a production-ready platform that demonstrates enterprise-level functionality for metals trading and hedging operations.
