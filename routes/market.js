const express = require('express');
const axios = require('axios');
const { authenticateOptional } = require('../middleware/auth');
const router = express.Router();

// Cache for market data to avoid excessive API calls
let marketDataCache = {};
let lastCacheUpdate = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Get current market data for all metals
router.get('/data', authenticateOptional, async (req, res) => {
    try {
        const now = Date.now();
        
        // Check if we have fresh cached data
        if (now - lastCacheUpdate < CACHE_DURATION && Object.keys(marketDataCache).length > 0) {
            return res.json({ 
                data: marketDataCache,
                cached: true,
                timestamp: new Date(lastCacheUpdate).toISOString()
            });
        }

        // Get latest data from database
        const marketData = await req.db.all(`
            SELECT metal_type, price, change_24h, change_percent, volume, market_cap, timestamp
            FROM market_data 
            WHERE timestamp > datetime('now', '-1 hour')
            ORDER BY metal_type, timestamp DESC
        `);

        // Group by metal type and get the latest entry for each
        const latestData = {};
        marketData.forEach(row => {
            if (!latestData[row.metal_type] || new Date(row.timestamp) > new Date(latestData[row.metal_type].timestamp)) {
                latestData[row.metal_type] = row;
            }
        });

        // If we have real-time data enabled, fetch from external APIs
        if (process.env.ENABLE_REAL_DATA === 'true') {
            await updateRealTimeData(req.db, latestData);
        } else {
            // Simulate price changes for demo
            await simulatePriceChanges(req.db, latestData);
        }

        // Update cache
        marketDataCache = latestData;
        lastCacheUpdate = now;

        res.json({ 
            data: latestData,
            cached: false,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Market data error:', error);
        res.status(500).json({ error: 'Failed to fetch market data' });
    }
});

// Get historical data for a specific metal
router.get('/history/:metal', authenticateOptional, async (req, res) => {
    try {
        const { metal } = req.params;
        const { period = '24h', interval = '1h' } = req.query;

        let timeFilter = '';
        switch (period) {
            case '1h':
                timeFilter = "datetime('now', '-1 hour')";
                break;
            case '24h':
                timeFilter = "datetime('now', '-1 day')";
                break;
            case '7d':
                timeFilter = "datetime('now', '-7 days')";
                break;
            case '30d':
                timeFilter = "datetime('now', '-30 days')";
                break;
            default:
                timeFilter = "datetime('now', '-1 day')";
        }

        const historicalData = await req.db.all(`
            SELECT price, volume, timestamp
            FROM market_data 
            WHERE metal_type = ? AND timestamp > ${timeFilter}
            ORDER BY timestamp ASC
        `, [metal]);

        // Calculate additional metrics
        const prices = historicalData.map(d => d.price);
        const high24h = Math.max(...prices);
        const low24h = Math.min(...prices);
        const avgVolume = historicalData.reduce((sum, d) => sum + (d.volume || 0), 0) / historicalData.length;

        res.json({
            metal,
            period,
            data: historicalData,
            metrics: {
                high24h,
                low24h,
                avgVolume,
                dataPoints: historicalData.length
            }
        });

    } catch (error) {
        console.error('Historical data error:', error);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// Get market summary and statistics
router.get('/summary', authenticateOptional, async (req, res) => {
    try {
        // Get latest prices for all metals
        const latestPrices = await req.db.all(`
            SELECT DISTINCT metal_type,
                   FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as current_price,
                   FIRST_VALUE(change_percent) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as change_percent,
                   FIRST_VALUE(volume) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as volume
            FROM market_data 
            WHERE timestamp > datetime('now', '-2 hours')
        `);

        // Calculate market statistics
        const totalVolume = latestPrices.reduce((sum, metal) => sum + (metal.volume || 0), 0);
        const gainers = latestPrices.filter(metal => metal.change_percent > 0).length;
        const losers = latestPrices.filter(metal => metal.change_percent < 0).length;
        const unchanged = latestPrices.filter(metal => metal.change_percent === 0).length;

        // Get top movers
        const topGainers = latestPrices
            .filter(metal => metal.change_percent > 0)
            .sort((a, b) => b.change_percent - a.change_percent)
            .slice(0, 3);

        const topLosers = latestPrices
            .filter(metal => metal.change_percent < 0)
            .sort((a, b) => a.change_percent - b.change_percent)
            .slice(0, 3);

        res.json({
            summary: {
                totalMetals: latestPrices.length,
                totalVolume,
                gainers,
                losers,
                unchanged
            },
            topGainers,
            topLosers,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Market summary error:', error);
        res.status(500).json({ error: 'Failed to fetch market summary' });
    }
});

// Get real-time price for a specific metal
router.get('/price/:metal', authenticateOptional, async (req, res) => {
    try {
        const { metal } = req.params;

        const currentPrice = await req.db.get(`
            SELECT price, change_24h, change_percent, volume, timestamp
            FROM market_data 
            WHERE metal_type = ?
            ORDER BY timestamp DESC
            LIMIT 1
        `, [metal]);

        if (!currentPrice) {
            return res.status(404).json({ error: 'Metal not found' });
        }

        res.json({
            metal,
            ...currentPrice,
            lastUpdated: currentPrice.timestamp
        });

    } catch (error) {
        console.error('Price fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch price' });
    }
});

// WebSocket endpoint for real-time updates (placeholder)
router.get('/ws-info', (req, res) => {
    res.json({
        websocketUrl: `ws://${req.get('host')}/ws/market`,
        protocols: ['market-data'],
        reconnectInterval: 5000,
        maxReconnectAttempts: 10
    });
});

// Helper function to simulate price changes
async function simulatePriceChanges(db, currentData) {
    const metals = Object.keys(currentData);
    
    for (const metal of metals) {
        const current = currentData[metal];
        if (!current) continue;

        // Simulate realistic price movement (±2% max change)
        const changePercent = (Math.random() - 0.5) * 4; // -2% to +2%
        const newPrice = current.price * (1 + changePercent / 100);
        const priceChange = newPrice - current.price;
        
        // Simulate volume changes
        const volumeChange = (Math.random() - 0.5) * 0.4; // ±20%
        const newVolume = Math.max(0, current.volume * (1 + volumeChange));

        // Update database with new simulated data
        await db.run(`
            INSERT INTO market_data (metal_type, price, change_24h, change_percent, volume, market_cap)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            metal,
            parseFloat(newPrice.toFixed(2)),
            parseFloat(priceChange.toFixed(2)),
            parseFloat(changePercent.toFixed(2)),
            Math.round(newVolume),
            Math.round(newPrice * newVolume * 0.1) // Simplified market cap calculation
        ]);

        // Update the current data object
        currentData[metal] = {
            ...current,
            price: parseFloat(newPrice.toFixed(2)),
            change_24h: parseFloat(priceChange.toFixed(2)),
            change_percent: parseFloat(changePercent.toFixed(2)),
            volume: Math.round(newVolume),
            timestamp: new Date().toISOString()
        };
    }
}

// Helper function to fetch real market data (placeholder for actual API integration)
async function updateRealTimeData(db, currentData) {
    // This would integrate with real APIs like:
    // - London Metal Exchange (LME)
    // - Alpha Vantage
    // - Metals API
    // - Yahoo Finance
    
    try {
        // Example API call structure (commented out as it requires real API keys)
        /*
        const apiKey = process.env.METALS_API_KEY;
        const response = await axios.get(`https://api.metals.live/v1/spot`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        // Process real API data and update database
        for (const metalData of response.data) {
            await db.run(`
                INSERT INTO market_data (metal_type, price, change_24h, change_percent, volume)
                VALUES (?, ?, ?, ?, ?)
            `, [metalData.symbol, metalData.price, metalData.change, metalData.changePercent, metalData.volume]);
        }
        */
        
        // For now, fall back to simulation
        await simulatePriceChanges(db, currentData);
        
    } catch (error) {
        console.error('Real-time data fetch error:', error);
        // Fall back to simulation if real API fails
        await simulatePriceChanges(db, currentData);
    }
}

module.exports = router;
