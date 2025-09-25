const express = require('express');
const moment = require('moment');
const router = express.Router();

// Get dashboard overview
router.get('/overview', async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get user's active positions summary
        const positionsSummary = await req.db.get(`
            SELECT 
                COUNT(*) as total_positions,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_positions,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_positions
            FROM hedging_positions 
            WHERE user_id = ?
        `, [userId]);

        // Get current P&L for active positions
        const activePnL = await req.db.all(`
            SELECT hp.*, md.price as current_market_price
            FROM hedging_positions hp
            LEFT JOIN (
                SELECT DISTINCT metal_type,
                       FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as price
                FROM market_data 
                WHERE timestamp > datetime('now', '-1 hour')
            ) md ON hp.metal_type = md.metal_type
            WHERE hp.user_id = ? AND hp.status = 'active'
        `, [userId]);

        let totalUnrealizedPnL = 0;
        activePnL.forEach(position => {
            const currentPrice = position.current_market_price || position.entry_price;
            let pnl = 0;
            
            if (position.position_type === 'long') {
                pnl = (currentPrice - position.entry_price) * position.quantity;
            } else {
                pnl = (position.entry_price - currentPrice) * position.quantity;
            }
            
            totalUnrealizedPnL += pnl;
        });

        // Get realized P&L from closed positions
        const realizedPnL = await req.db.get(`
            SELECT 
                COALESCE(SUM(profit_loss), 0) as total_realized_pnl,
                COUNT(*) as closed_trades,
                SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as winning_trades
            FROM hedging_positions 
            WHERE user_id = ? AND status = 'closed'
        `, [userId]);

        // Get recent activity
        const recentActivity = await req.db.all(`
            SELECT action, details, created_at
            FROM audit_log 
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 10
        `, [userId]);

        // Get portfolio distribution by metal
        const portfolioDistribution = await req.db.all(`
            SELECT 
                metal_type,
                COUNT(*) as position_count,
                SUM(quantity * entry_price) as total_value,
                SUM(CASE WHEN position_type = 'long' THEN quantity ELSE 0 END) as long_quantity,
                SUM(CASE WHEN position_type = 'short' THEN quantity ELSE 0 END) as short_quantity
            FROM hedging_positions 
            WHERE user_id = ? AND status = 'active'
            GROUP BY metal_type
        `, [userId]);

        // Get notifications count
        const notificationsCount = await req.db.get(`
            SELECT COUNT(*) as unread_count
            FROM notifications 
            WHERE user_id = ? AND is_read = 0
        `, [userId]);

        // Calculate win rate
        const winRate = realizedPnL.closed_trades > 0 
            ? (realizedPnL.winning_trades / realizedPnL.closed_trades * 100).toFixed(2)
            : 0;

        res.json({
            summary: {
                totalPositions: positionsSummary.total_positions || 0,
                activePositions: positionsSummary.active_positions || 0,
                closedPositions: positionsSummary.closed_positions || 0,
                totalUnrealizedPnL: parseFloat(totalUnrealizedPnL.toFixed(2)),
                totalRealizedPnL: parseFloat(realizedPnL.total_realized_pnl.toFixed(2)),
                winRate: parseFloat(winRate),
                unreadNotifications: notificationsCount.unread_count || 0
            },
            portfolioDistribution: portfolioDistribution.map(item => ({
                ...item,
                total_value: parseFloat(item.total_value.toFixed(2))
            })),
            recentActivity: recentActivity.map(activity => ({
                ...activity,
                created_at: moment(activity.created_at).fromNow()
            }))
        });

    } catch (error) {
        console.error('Dashboard overview error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard overview' });
    }
});

// Get performance chart data
router.get('/performance', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { period = '30d' } = req.query;

        let dateFilter = '';
        let groupBy = '';
        
        switch (period) {
            case '7d':
                dateFilter = "datetime('now', '-7 days')";
                groupBy = "date(created_at)";
                break;
            case '30d':
                dateFilter = "datetime('now', '-30 days')";
                groupBy = "date(created_at)";
                break;
            case '90d':
                dateFilter = "datetime('now', '-90 days')";
                groupBy = "strftime('%Y-%W', created_at)"; // Weekly grouping
                break;
            case '1y':
                dateFilter = "datetime('now', '-1 year')";
                groupBy = "strftime('%Y-%m', created_at)"; // Monthly grouping
                break;
            default:
                dateFilter = "datetime('now', '-30 days')";
                groupBy = "date(created_at)";
        }

        // Get daily/weekly/monthly P&L
        const performanceData = await req.db.all(`
            SELECT 
                ${groupBy} as period,
                SUM(CASE WHEN status = 'closed' THEN profit_loss ELSE 0 END) as realized_pnl,
                COUNT(CASE WHEN status = 'closed' THEN 1 END) as trades_closed,
                COUNT(*) as total_trades
            FROM hedging_positions 
            WHERE user_id = ? AND created_at > ${dateFilter}
            GROUP BY ${groupBy}
            ORDER BY period ASC
        `, [userId]);

        // Calculate cumulative P&L
        let cumulativePnL = 0;
        const chartData = performanceData.map(row => {
            cumulativePnL += row.realized_pnl;
            return {
                period: row.period,
                realized_pnl: parseFloat(row.realized_pnl.toFixed(2)),
                cumulative_pnl: parseFloat(cumulativePnL.toFixed(2)),
                trades_closed: row.trades_closed,
                total_trades: row.total_trades
            };
        });

        res.json({
            period,
            data: chartData,
            summary: {
                totalPeriods: chartData.length,
                finalCumulativePnL: parseFloat(cumulativePnL.toFixed(2)),
                totalTrades: performanceData.reduce((sum, row) => sum + row.total_trades, 0),
                totalClosedTrades: performanceData.reduce((sum, row) => sum + row.trades_closed, 0)
            }
        });

    } catch (error) {
        console.error('Performance data error:', error);
        res.status(500).json({ error: 'Failed to fetch performance data' });
    }
});

// Get risk metrics
router.get('/risk-metrics', async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get active positions with current market data
        const activePositions = await req.db.all(`
            SELECT hp.*, md.price as current_market_price
            FROM hedging_positions hp
            LEFT JOIN (
                SELECT DISTINCT metal_type,
                       FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as price
                FROM market_data 
                WHERE timestamp > datetime('now', '-1 hour')
            ) md ON hp.metal_type = md.metal_type
            WHERE hp.user_id = ? AND hp.status = 'active'
        `, [userId]);

        // Calculate portfolio metrics
        let totalExposure = 0;
        let totalUnrealizedPnL = 0;
        const metalExposure = {};
        const positionTypeExposure = { long: 0, short: 0 };

        activePositions.forEach(position => {
            const currentPrice = position.current_market_price || position.entry_price;
            const positionValue = position.quantity * position.entry_price;
            
            totalExposure += positionValue;
            
            // Calculate unrealized P&L
            let pnl = 0;
            if (position.position_type === 'long') {
                pnl = (currentPrice - position.entry_price) * position.quantity;
            } else {
                pnl = (position.entry_price - currentPrice) * position.quantity;
            }
            totalUnrealizedPnL += pnl;

            // Track exposure by metal
            if (!metalExposure[position.metal_type]) {
                metalExposure[position.metal_type] = 0;
            }
            metalExposure[position.metal_type] += positionValue;

            // Track exposure by position type
            positionTypeExposure[position.position_type] += positionValue;
        });

        // Calculate concentration risk (largest single metal exposure)
        const maxMetalExposure = Math.max(...Object.values(metalExposure), 0);
        const concentrationRisk = totalExposure > 0 ? (maxMetalExposure / totalExposure * 100) : 0;

        // Calculate positions at risk (stop loss triggered)
        const positionsAtRisk = activePositions.filter(position => {
            if (!position.stop_loss || !position.current_market_price) return false;
            
            if (position.position_type === 'long') {
                return position.current_market_price <= position.stop_loss;
            } else {
                return position.current_market_price >= position.stop_loss;
            }
        });

        // Calculate Value at Risk (simplified - 5% worst case scenario)
        const var5Percent = totalExposure * 0.05;

        // Get historical volatility data
        const volatilityData = await req.db.all(`
            SELECT 
                metal_type,
                AVG(ABS(change_percent)) as avg_volatility,
                MAX(ABS(change_percent)) as max_volatility
            FROM market_data 
            WHERE timestamp > datetime('now', '-30 days')
            GROUP BY metal_type
        `);

        // Calculate portfolio beta (simplified - average volatility weighted by exposure)
        let portfolioBeta = 0;
        if (totalExposure > 0) {
            Object.keys(metalExposure).forEach(metal => {
                const metalVol = volatilityData.find(v => v.metal_type === metal);
                if (metalVol) {
                    const weight = metalExposure[metal] / totalExposure;
                    portfolioBeta += weight * (metalVol.avg_volatility / 100);
                }
            });
        }

        res.json({
            totalExposure: parseFloat(totalExposure.toFixed(2)),
            totalUnrealizedPnL: parseFloat(totalUnrealizedPnL.toFixed(2)),
            concentrationRisk: parseFloat(concentrationRisk.toFixed(2)),
            portfolioBeta: parseFloat(portfolioBeta.toFixed(4)),
            valueAtRisk: parseFloat(var5Percent.toFixed(2)),
            positionsAtRisk: positionsAtRisk.length,
            metalExposure: Object.keys(metalExposure).map(metal => ({
                metal,
                exposure: parseFloat(metalExposure[metal].toFixed(2)),
                percentage: parseFloat((metalExposure[metal] / totalExposure * 100).toFixed(2))
            })),
            positionTypeBalance: {
                long: parseFloat(positionTypeExposure.long.toFixed(2)),
                short: parseFloat(positionTypeExposure.short.toFixed(2)),
                longPercentage: totalExposure > 0 ? parseFloat((positionTypeExposure.long / totalExposure * 100).toFixed(2)) : 0,
                shortPercentage: totalExposure > 0 ? parseFloat((positionTypeExposure.short / totalExposure * 100).toFixed(2)) : 0
            },
            riskLevel: concentrationRisk > 50 ? 'high' : concentrationRisk > 30 ? 'medium' : 'low'
        });

    } catch (error) {
        console.error('Risk metrics error:', error);
        res.status(500).json({ error: 'Failed to fetch risk metrics' });
    }
});

// Get market alerts and notifications
router.get('/alerts', async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get active trading alerts
        const tradingAlerts = await req.db.all(`
            SELECT ta.*, md.price as current_price
            FROM trading_alerts ta
            LEFT JOIN (
                SELECT DISTINCT metal_type,
                       FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as price
                FROM market_data 
                WHERE timestamp > datetime('now', '-1 hour')
            ) md ON ta.metal_type = md.metal_type
            WHERE ta.user_id = ? AND ta.is_active = 1
            ORDER BY ta.created_at DESC
        `, [userId]);

        // Check which alerts should be triggered
        const triggeredAlerts = [];
        for (const alert of tradingAlerts) {
            if (!alert.current_price) continue;

            let shouldTrigger = false;
            
            switch (alert.alert_type) {
                case 'price_above':
                    shouldTrigger = alert.current_price >= alert.target_value;
                    break;
                case 'price_below':
                    shouldTrigger = alert.current_price <= alert.target_value;
                    break;
                case 'volume_spike':
                    // This would require volume data comparison
                    break;
            }

            if (shouldTrigger && !alert.triggered_at) {
                triggeredAlerts.push(alert);
                
                // Mark alert as triggered and create notification
                await req.db.run(`
                    UPDATE trading_alerts 
                    SET triggered_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `, [alert.id]);

                await req.db.run(`
                    INSERT INTO notifications (user_id, title, message, type)
                    VALUES (?, ?, ?, ?)
                `, [
                    userId,
                    'Price Alert Triggered',
                    `${alert.metal_type} has reached your target price of $${alert.target_value}. Current price: $${alert.current_price}`,
                    'warning'
                ]);
            }
        }

        // Get recent notifications
        const recentNotifications = await req.db.all(`
            SELECT id, title, message, type, is_read, created_at
            FROM notifications 
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [userId]);

        // Get positions approaching expiry
        const expiringPositions = await req.db.all(`
            SELECT id, metal_type, position_type, quantity, expiry_date
            FROM hedging_positions 
            WHERE user_id = ? AND status = 'active' 
            AND date(expiry_date) <= date('now', '+7 days')
            ORDER BY expiry_date ASC
        `, [userId]);

        res.json({
            tradingAlerts: tradingAlerts.map(alert => ({
                ...alert,
                days_until_expiry: moment(alert.expiry_date).diff(moment(), 'days'),
                is_triggered: !!alert.triggered_at
            })),
            triggeredAlerts: triggeredAlerts.length,
            recentNotifications,
            expiringPositions: expiringPositions.map(position => ({
                ...position,
                days_until_expiry: moment(position.expiry_date).diff(moment(), 'days')
            })),
            summary: {
                activeAlerts: tradingAlerts.filter(a => !a.triggered_at).length,
                triggeredToday: triggeredAlerts.length,
                unreadNotifications: recentNotifications.filter(n => !n.is_read).length,
                positionsExpiringThisWeek: expiringPositions.length
            }
        });

    } catch (error) {
        console.error('Alerts error:', error);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

// Get market overview for dashboard
router.get('/market-overview', async (req, res) => {
    try {
        // Get latest market data for all metals
        const marketData = await req.db.all(`
            SELECT DISTINCT metal_type,
                   FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as current_price,
                   FIRST_VALUE(change_percent) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as change_percent,
                   FIRST_VALUE(volume) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as volume
            FROM market_data 
            WHERE timestamp > datetime('now', '-2 hours')
            ORDER BY metal_type
        `);

        // Calculate market statistics
        const totalVolume = marketData.reduce((sum, metal) => sum + (metal.volume || 0), 0);
        const gainers = marketData.filter(metal => metal.change_percent > 0);
        const losers = marketData.filter(metal => metal.change_percent < 0);
        
        // Get top movers
        const topGainer = gainers.length > 0 
            ? gainers.reduce((max, metal) => metal.change_percent > max.change_percent ? metal : max)
            : null;
            
        const topLoser = losers.length > 0 
            ? losers.reduce((min, metal) => metal.change_percent < min.change_percent ? metal : min)
            : null;

        // Get market trend (simplified - based on average change)
        const avgChange = marketData.reduce((sum, metal) => sum + metal.change_percent, 0) / marketData.length;
        const marketTrend = avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral';

        res.json({
            marketData: marketData.map(metal => ({
                ...metal,
                current_price: parseFloat(metal.current_price.toFixed(2)),
                change_percent: parseFloat(metal.change_percent.toFixed(2))
            })),
            marketSummary: {
                totalMetals: marketData.length,
                totalVolume: Math.round(totalVolume),
                gainers: gainers.length,
                losers: losers.length,
                unchanged: marketData.length - gainers.length - losers.length,
                avgChange: parseFloat(avgChange.toFixed(2)),
                marketTrend
            },
            topMovers: {
                topGainer: topGainer ? {
                    metal: topGainer.metal_type,
                    change: parseFloat(topGainer.change_percent.toFixed(2)),
                    price: parseFloat(topGainer.current_price.toFixed(2))
                } : null,
                topLoser: topLoser ? {
                    metal: topLoser.metal_type,
                    change: parseFloat(topLoser.change_percent.toFixed(2)),
                    price: parseFloat(topLoser.current_price.toFixed(2))
                } : null
            },
            lastUpdated: new Date().toISOString()
        });

    } catch (error) {
        console.error('Market overview error:', error);
        res.status(500).json({ error: 'Failed to fetch market overview' });
    }
});

module.exports = router;
