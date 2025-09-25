const express = require('express');
const moment = require('moment');
const router = express.Router();

// Get user's hedging positions
router.get('/positions', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status = 'all', metal = 'all', limit = 50, offset = 0 } = req.query;

        let query = `
            SELECT hp.*, md.price as current_market_price
            FROM hedging_positions hp
            LEFT JOIN (
                SELECT DISTINCT metal_type,
                       FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as price
                FROM market_data 
                WHERE timestamp > datetime('now', '-1 hour')
            ) md ON hp.metal_type = md.metal_type
            WHERE hp.user_id = ?
        `;
        let params = [userId];

        if (status !== 'all') {
            query += ' AND hp.status = ?';
            params.push(status);
        }

        if (metal !== 'all') {
            query += ' AND hp.metal_type = ?';
            params.push(metal);
        }

        query += ' ORDER BY hp.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const positions = await req.db.all(query, params);

        // Calculate P&L for each position
        const enrichedPositions = positions.map(position => {
            const currentPrice = position.current_market_price || position.entry_price;
            let profitLoss = 0;

            if (position.position_type === 'long') {
                profitLoss = (currentPrice - position.entry_price) * position.quantity;
            } else {
                profitLoss = (position.entry_price - currentPrice) * position.quantity;
            }

            const profitLossPercent = ((profitLoss / (position.entry_price * position.quantity)) * 100);

            return {
                ...position,
                current_market_price: currentPrice,
                profit_loss: parseFloat(profitLoss.toFixed(2)),
                profit_loss_percent: parseFloat(profitLossPercent.toFixed(2)),
                days_to_expiry: moment(position.expiry_date).diff(moment(), 'days')
            };
        });

        // Get summary statistics
        const totalPositions = enrichedPositions.length;
        const activePositions = enrichedPositions.filter(p => p.status === 'active').length;
        const totalPnL = enrichedPositions.reduce((sum, p) => sum + p.profit_loss, 0);

        res.json({
            positions: enrichedPositions,
            summary: {
                totalPositions,
                activePositions,
                totalPnL: parseFloat(totalPnL.toFixed(2))
            }
        });

    } catch (error) {
        console.error('Get positions error:', error);
        res.status(500).json({ error: 'Failed to fetch hedging positions' });
    }
});

// Create new hedging position
router.post('/positions', async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            metalType,
            positionType,
            quantity,
            entryPrice,
            targetPrice,
            stopLoss,
            contractDate,
            expiryDate
        } = req.body;

        // Validation
        if (!metalType || !positionType || !quantity || !entryPrice || !contractDate || !expiryDate) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        if (!['long', 'short'].includes(positionType)) {
            return res.status(400).json({ error: 'Position type must be either "long" or "short"' });
        }

        if (quantity <= 0 || entryPrice <= 0) {
            return res.status(400).json({ error: 'Quantity and entry price must be positive numbers' });
        }

        if (moment(expiryDate).isBefore(moment(contractDate))) {
            return res.status(400).json({ error: 'Expiry date must be after contract date' });
        }

        // Check user's subscription limits
        const user = await req.db.get('SELECT subscription_plan FROM users WHERE id = ?', [userId]);
        const positionCount = await req.db.get('SELECT COUNT(*) as count FROM hedging_positions WHERE user_id = ? AND status = "active"', [userId]);

        const limits = {
            basic: 5,
            pro: 25,
            enterprise: 1000
        };

        if (positionCount.count >= limits[user.subscription_plan]) {
            return res.status(403).json({ 
                error: `Position limit reached for ${user.subscription_plan} plan. Upgrade to create more positions.` 
            });
        }

        // Get current market price for validation
        const marketData = await req.db.get(`
            SELECT price FROM market_data 
            WHERE metal_type = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        `, [metalType]);

        if (marketData && Math.abs(entryPrice - marketData.price) / marketData.price > 0.1) {
            return res.status(400).json({ 
                error: 'Entry price is more than 10% away from current market price' 
            });
        }

        // Create the position
        const result = await req.db.run(`
            INSERT INTO hedging_positions (
                user_id, metal_type, position_type, quantity, entry_price, 
                target_price, stop_loss, contract_date, expiry_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId, metalType, positionType, quantity, entryPrice,
            targetPrice || null, stopLoss || null, contractDate, expiryDate
        ]);

        // Log the position creation
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [userId, 'POSITION_CREATED', `Created ${positionType} position for ${quantity} ${metalType} at ${entryPrice}`, req.ip]);

        // Create notification
        await req.db.run(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, ?)
        `, [
            userId,
            'New Position Created',
            `Your ${positionType} position for ${quantity} ${metalType} has been created successfully.`,
            'success'
        ]);

        res.status(201).json({
            message: 'Hedging position created successfully',
            positionId: result.id
        });

    } catch (error) {
        console.error('Create position error:', error);
        res.status(500).json({ error: 'Failed to create hedging position' });
    }
});

// Update hedging position
router.put('/positions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const { targetPrice, stopLoss, status } = req.body;

        // Check if position belongs to user
        const position = await req.db.get(`
            SELECT * FROM hedging_positions 
            WHERE id = ? AND user_id = ?
        `, [id, userId]);

        if (!position) {
            return res.status(404).json({ error: 'Position not found' });
        }

        if (position.status === 'closed') {
            return res.status(400).json({ error: 'Cannot modify closed position' });
        }

        let updateFields = [];
        let params = [];

        if (targetPrice !== undefined) {
            updateFields.push('target_price = ?');
            params.push(targetPrice);
        }

        if (stopLoss !== undefined) {
            updateFields.push('stop_loss = ?');
            params.push(stopLoss);
        }

        if (status && ['active', 'closed'].includes(status)) {
            updateFields.push('status = ?');
            params.push(status);

            // If closing position, calculate final P&L
            if (status === 'closed') {
                const currentPrice = await req.db.get(`
                    SELECT price FROM market_data 
                    WHERE metal_type = ? 
                    ORDER BY timestamp DESC 
                    LIMIT 1
                `, [position.metal_type]);

                if (currentPrice) {
                    let finalPnL = 0;
                    if (position.position_type === 'long') {
                        finalPnL = (currentPrice.price - position.entry_price) * position.quantity;
                    } else {
                        finalPnL = (position.entry_price - currentPrice.price) * position.quantity;
                    }

                    updateFields.push('profit_loss = ?');
                    params.push(parseFloat(finalPnL.toFixed(2)));
                }
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id, userId);

        await req.db.run(`
            UPDATE hedging_positions 
            SET ${updateFields.join(', ')} 
            WHERE id = ? AND user_id = ?
        `, params);

        // Log the update
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [userId, 'POSITION_UPDATED', `Updated position ${id}`, req.ip]);

        res.json({ message: 'Position updated successfully' });

    } catch (error) {
        console.error('Update position error:', error);
        res.status(500).json({ error: 'Failed to update position' });
    }
});

// Close hedging position
router.post('/positions/:id/close', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const { closePrice } = req.body;

        const position = await req.db.get(`
            SELECT * FROM hedging_positions 
            WHERE id = ? AND user_id = ? AND status = 'active'
        `, [id, userId]);

        if (!position) {
            return res.status(404).json({ error: 'Active position not found' });
        }

        // Use provided close price or current market price
        let finalClosePrice = closePrice;
        if (!finalClosePrice) {
            const marketData = await req.db.get(`
                SELECT price FROM market_data 
                WHERE metal_type = ? 
                ORDER BY timestamp DESC 
                LIMIT 1
            `, [position.metal_type]);
            finalClosePrice = marketData ? marketData.price : position.entry_price;
        }

        // Calculate final P&L
        let finalPnL = 0;
        if (position.position_type === 'long') {
            finalPnL = (finalClosePrice - position.entry_price) * position.quantity;
        } else {
            finalPnL = (position.entry_price - finalClosePrice) * position.quantity;
        }

        await req.db.run(`
            UPDATE hedging_positions 
            SET status = 'closed', profit_loss = ?, current_price = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [parseFloat(finalPnL.toFixed(2)), finalClosePrice, id]);

        // Log the closure
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [userId, 'POSITION_CLOSED', `Closed position ${id} with P&L: ${finalPnL.toFixed(2)}`, req.ip]);

        // Create notification
        const pnlType = finalPnL >= 0 ? 'profit' : 'loss';
        await req.db.run(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, ?)
        `, [
            userId,
            'Position Closed',
            `Your ${position.position_type} position for ${position.metal_type} has been closed with a ${pnlType} of $${Math.abs(finalPnL).toFixed(2)}.`,
            finalPnL >= 0 ? 'success' : 'warning'
        ]);

        res.json({
            message: 'Position closed successfully',
            finalPnL: parseFloat(finalPnL.toFixed(2)),
            closePrice: finalClosePrice
        });

    } catch (error) {
        console.error('Close position error:', error);
        res.status(500).json({ error: 'Failed to close position' });
    }
});

// Get position analytics
router.get('/analytics', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { period = '30d' } = req.query;

        let dateFilter = '';
        switch (period) {
            case '7d':
                dateFilter = "datetime('now', '-7 days')";
                break;
            case '30d':
                dateFilter = "datetime('now', '-30 days')";
                break;
            case '90d':
                dateFilter = "datetime('now', '-90 days')";
                break;
            case '1y':
                dateFilter = "datetime('now', '-1 year')";
                break;
            default:
                dateFilter = "datetime('now', '-30 days')";
        }

        // Get performance metrics
        const performanceData = await req.db.all(`
            SELECT 
                metal_type,
                position_type,
                COUNT(*) as total_positions,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_positions,
                SUM(CASE WHEN status = 'closed' AND profit_loss > 0 THEN 1 ELSE 0 END) as winning_positions,
                SUM(CASE WHEN status = 'closed' THEN profit_loss ELSE 0 END) as total_pnl,
                AVG(CASE WHEN status = 'closed' THEN profit_loss ELSE NULL END) as avg_pnl,
                MAX(CASE WHEN status = 'closed' THEN profit_loss ELSE NULL END) as best_trade,
                MIN(CASE WHEN status = 'closed' THEN profit_loss ELSE NULL END) as worst_trade
            FROM hedging_positions 
            WHERE user_id = ? AND created_at > ${dateFilter}
            GROUP BY metal_type, position_type
        `, [userId]);

        // Calculate overall statistics
        const overallStats = await req.db.get(`
            SELECT 
                COUNT(*) as total_positions,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_positions,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_positions,
                SUM(CASE WHEN status = 'closed' AND profit_loss > 0 THEN 1 ELSE 0 END) as winning_positions,
                SUM(CASE WHEN status = 'closed' THEN profit_loss ELSE 0 END) as total_realized_pnl,
                AVG(CASE WHEN status = 'closed' THEN profit_loss ELSE NULL END) as avg_trade_pnl
            FROM hedging_positions 
            WHERE user_id = ? AND created_at > ${dateFilter}
        `, [userId]);

        // Calculate win rate
        const winRate = overallStats.closed_positions > 0 
            ? (overallStats.winning_positions / overallStats.closed_positions * 100).toFixed(2)
            : 0;

        res.json({
            period,
            overallStats: {
                ...overallStats,
                win_rate: parseFloat(winRate),
                total_realized_pnl: parseFloat((overallStats.total_realized_pnl || 0).toFixed(2)),
                avg_trade_pnl: parseFloat((overallStats.avg_trade_pnl || 0).toFixed(2))
            },
            performanceByMetal: performanceData.map(row => ({
                ...row,
                win_rate: row.closed_positions > 0 ? ((row.winning_positions / row.closed_positions) * 100).toFixed(2) : 0,
                total_pnl: parseFloat((row.total_pnl || 0).toFixed(2)),
                avg_pnl: parseFloat((row.avg_pnl || 0).toFixed(2)),
                best_trade: parseFloat((row.best_trade || 0).toFixed(2)),
                worst_trade: parseFloat((row.worst_trade || 0).toFixed(2))
            }))
        });

    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Get hedging recommendations
router.get('/recommendations', async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get user's current positions
        const activePositions = await req.db.all(`
            SELECT metal_type, position_type, SUM(quantity) as total_quantity
            FROM hedging_positions 
            WHERE user_id = ? AND status = 'active'
            GROUP BY metal_type, position_type
        `, [userId]);

        // Get current market data
        const marketData = await req.db.all(`
            SELECT DISTINCT metal_type,
                   FIRST_VALUE(price) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as current_price,
                   FIRST_VALUE(change_percent) OVER (PARTITION BY metal_type ORDER BY timestamp DESC) as change_percent
            FROM market_data 
            WHERE timestamp > datetime('now', '-1 hour')
        `);

        // Generate recommendations based on market conditions and user positions
        const recommendations = [];

        for (const metal of marketData) {
            const userPosition = activePositions.find(p => p.metal_type === metal.metal_type);
            
            // Recommendation logic
            if (Math.abs(metal.change_percent) > 3) {
                if (metal.change_percent > 3 && (!userPosition || userPosition.position_type !== 'short')) {
                    recommendations.push({
                        type: 'hedge_risk',
                        metal: metal.metal_type,
                        action: 'Consider short position',
                        reason: `${metal.metal_type} is up ${metal.change_percent.toFixed(2)}% - consider hedging against potential reversal`,
                        urgency: 'medium',
                        current_price: metal.current_price
                    });
                } else if (metal.change_percent < -3 && (!userPosition || userPosition.position_type !== 'long')) {
                    recommendations.push({
                        type: 'opportunity',
                        metal: metal.metal_type,
                        action: 'Consider long position',
                        reason: `${metal.metal_type} is down ${Math.abs(metal.change_percent).toFixed(2)}% - potential buying opportunity`,
                        urgency: 'medium',
                        current_price: metal.current_price
                    });
                }
            }

            // Check for overexposure
            if (userPosition && userPosition.total_quantity > 1000) {
                recommendations.push({
                    type: 'risk_management',
                    metal: metal.metal_type,
                    action: 'Consider reducing exposure',
                    reason: `High exposure to ${metal.metal_type} - consider diversifying or reducing position size`,
                    urgency: 'low',
                    current_price: metal.current_price
                });
            }
        }

        // Check for portfolio diversification
        const metalTypes = [...new Set(activePositions.map(p => p.metal_type))];
        if (metalTypes.length < 3 && activePositions.length > 0) {
            recommendations.push({
                type: 'diversification',
                metal: 'portfolio',
                action: 'Diversify across more metals',
                reason: 'Consider spreading risk across different metal types for better portfolio balance',
                urgency: 'low',
                current_price: null
            });
        }

        res.json({
            recommendations,
            portfolio_summary: {
                active_positions: activePositions.length,
                metals_covered: metalTypes.length,
                total_exposure: activePositions.reduce((sum, p) => sum + p.total_quantity, 0)
            }
        });

    } catch (error) {
        console.error('Recommendations error:', error);
        res.status(500).json({ error: 'Failed to generate recommendations' });
    }
});

module.exports = router;
