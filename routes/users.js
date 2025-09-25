const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

// Get current user profile
router.get('/profile', async (req, res) => {
    try {
        const user = await req.db.get(`
            SELECT id, email, first_name, last_name, company, phone, role, 
                   subscription_plan, is_verified, created_at, last_login
            FROM users WHERE id = ?
        `, [req.user.userId]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to get user profile' });
    }
});

// Update user profile
router.put('/profile', async (req, res) => {
    try {
        const { firstName, lastName, company, phone } = req.body;
        const userId = req.user.userId;

        // Validation
        if (!firstName || !lastName) {
            return res.status(400).json({ error: 'First name and last name are required' });
        }

        if (phone && !validator.isMobilePhone(phone)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        await req.db.run(`
            UPDATE users 
            SET first_name = ?, last_name = ?, company = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [firstName, lastName, company || null, phone || null, userId]);

        // Log the profile update
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [userId, 'PROFILE_UPDATED', 'User profile updated', req.ip]);

        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Change password
router.put('/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.userId;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long' });
        }

        // Get current user
        const user = await req.db.get('SELECT password FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedNewPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS));

        await req.db.run(`
            UPDATE users 
            SET password = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [hashedNewPassword, userId]);

        // Log the password change
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [userId, 'PASSWORD_CHANGED', 'User changed password', req.ip]);

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Get user notifications
router.get('/notifications', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { limit = 20, offset = 0 } = req.query;

        const notifications = await req.db.all(`
            SELECT id, title, message, type, is_read, created_at
            FROM notifications 
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [userId, parseInt(limit), parseInt(offset)]);

        const unreadCount = await req.db.get(`
            SELECT COUNT(*) as count 
            FROM notifications 
            WHERE user_id = ? AND is_read = 0
        `, [userId]);

        res.json({ 
            notifications,
            unreadCount: unreadCount.count
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

// Mark notification as read
router.put('/notifications/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        await req.db.run(`
            UPDATE notifications 
            SET is_read = 1 
            WHERE id = ? AND user_id = ?
        `, [id, userId]);

        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

// Get user trading alerts
router.get('/alerts', async (req, res) => {
    try {
        const userId = req.user.userId;

        const alerts = await req.db.all(`
            SELECT id, metal_type, alert_type, target_value, is_active, created_at, triggered_at
            FROM trading_alerts 
            WHERE user_id = ?
            ORDER BY created_at DESC
        `, [userId]);

        res.json({ alerts });
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({ error: 'Failed to get trading alerts' });
    }
});

// Create trading alert
router.post('/alerts', async (req, res) => {
    try {
        const { metalType, alertType, targetValue } = req.body;
        const userId = req.user.userId;

        if (!metalType || !alertType || !targetValue) {
            return res.status(400).json({ error: 'Metal type, alert type, and target value are required' });
        }

        const validAlertTypes = ['price_above', 'price_below', 'volume_spike'];
        if (!validAlertTypes.includes(alertType)) {
            return res.status(400).json({ error: 'Invalid alert type' });
        }

        const result = await req.db.run(`
            INSERT INTO trading_alerts (user_id, metal_type, alert_type, target_value)
            VALUES (?, ?, ?, ?)
        `, [userId, metalType, alertType, parseFloat(targetValue)]);

        res.status(201).json({ 
            message: 'Trading alert created successfully',
            alertId: result.id
        });
    } catch (error) {
        console.error('Create alert error:', error);
        res.status(500).json({ error: 'Failed to create trading alert' });
    }
});

// Update trading alert
router.put('/alerts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { targetValue, isActive } = req.body;
        const userId = req.user.userId;

        await req.db.run(`
            UPDATE trading_alerts 
            SET target_value = ?, is_active = ?
            WHERE id = ? AND user_id = ?
        `, [parseFloat(targetValue), isActive ? 1 : 0, id, userId]);

        res.json({ message: 'Trading alert updated successfully' });
    } catch (error) {
        console.error('Update alert error:', error);
        res.status(500).json({ error: 'Failed to update trading alert' });
    }
});

// Delete trading alert
router.delete('/alerts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        await req.db.run(`
            DELETE FROM trading_alerts 
            WHERE id = ? AND user_id = ?
        `, [id, userId]);

        res.json({ message: 'Trading alert deleted successfully' });
    } catch (error) {
        console.error('Delete alert error:', error);
        res.status(500).json({ error: 'Failed to delete trading alert' });
    }
});

// Admin only: Get all users
router.get('/admin/users', requireRole(['admin']), async (req, res) => {
    try {
        const { limit = 50, offset = 0, search = '' } = req.query;

        let query = `
            SELECT id, email, first_name, last_name, company, role, 
                   subscription_plan, is_verified, created_at, last_login
            FROM users
        `;
        let params = [];

        if (search) {
            query += ` WHERE email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ?`;
            const searchTerm = `%${search}%`;
            params = [searchTerm, searchTerm, searchTerm, searchTerm];
        }

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const users = await req.db.all(query, params);

        const totalCount = await req.db.get(`
            SELECT COUNT(*) as count FROM users
            ${search ? 'WHERE email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ?' : ''}
        `, search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : []);

        res.json({ 
            users,
            totalCount: totalCount.count
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Admin only: Update user role/subscription
router.put('/admin/users/:id', requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { role, subscriptionPlan } = req.body;

        const validRoles = ['user', 'admin'];
        const validPlans = ['basic', 'pro', 'enterprise'];

        if (role && !validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        if (subscriptionPlan && !validPlans.includes(subscriptionPlan)) {
            return res.status(400).json({ error: 'Invalid subscription plan' });
        }

        let updateFields = [];
        let params = [];

        if (role) {
            updateFields.push('role = ?');
            params.push(role);
        }

        if (subscriptionPlan) {
            updateFields.push('subscription_plan = ?');
            params.push(subscriptionPlan);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        await req.db.run(`
            UPDATE users SET ${updateFields.join(', ')} WHERE id = ?
        `, params);

        // Log the admin action
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [req.user.userId, 'ADMIN_USER_UPDATE', `Updated user ${id}: role=${role}, plan=${subscriptionPlan}`, req.ip]);

        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Admin update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

module.exports = router;
