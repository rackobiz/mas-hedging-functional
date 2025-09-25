const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, company, phone } = req.body;

        // Validation
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        if (!validator.isEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        // Check if user already exists
        const existingUser = await req.db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({ error: 'User with this email already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));
        const verificationToken = uuidv4();

        // Create user
        const result = await req.db.run(`
            INSERT INTO users (email, password, first_name, last_name, company, phone, verification_token)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [email, hashedPassword, firstName, lastName, company || null, phone || null, verificationToken]);

        // Log the registration
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [result.id, 'USER_REGISTERED', `User registered: ${email}`, req.ip]);

        res.status(201).json({
            message: 'User registered successfully',
            userId: result.id,
            verificationRequired: true
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login user
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const user = await req.db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await req.db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                role: user.role,
                subscriptionPlan: user.subscription_plan
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        // Log the login
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [user.id, 'USER_LOGIN', `User logged in: ${email}`, req.ip]);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                company: user.company,
                role: user.role,
                subscriptionPlan: user.subscription_plan,
                isVerified: user.is_verified
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify email
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Verification token is required' });
        }

        const user = await req.db.get('SELECT * FROM users WHERE verification_token = ?', [token]);
        if (!user) {
            return res.status(400).json({ error: 'Invalid verification token' });
        }

        // Update user as verified
        await req.db.run(`
            UPDATE users 
            SET is_verified = 1, verification_token = NULL, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [user.id]);

        // Log the verification
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [user.id, 'EMAIL_VERIFIED', `Email verified: ${user.email}`, req.ip]);

        res.json({ message: 'Email verified successfully' });

    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ error: 'Email verification failed' });
    }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || !validator.isEmail(email)) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        const user = await req.db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            // Don't reveal if email exists or not
            return res.json({ message: 'If the email exists, a reset link has been sent' });
        }

        const resetToken = uuidv4();
        const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now

        await req.db.run(`
            UPDATE users 
            SET reset_token = ?, reset_token_expires = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [resetToken, resetExpires.toISOString(), user.id]);

        // Log the password reset request
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [user.id, 'PASSWORD_RESET_REQUESTED', `Password reset requested: ${email}`, req.ip]);

        // In a real application, you would send an email here
        console.log(`Password reset token for ${email}: ${resetToken}`);

        res.json({ message: 'If the email exists, a reset link has been sent' });

    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ error: 'Password reset request failed' });
    }
});

// Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        const user = await req.db.get(`
            SELECT * FROM users 
            WHERE reset_token = ? AND reset_token_expires > datetime('now')
        `, [token]);

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS));

        await req.db.run(`
            UPDATE users 
            SET password = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [hashedPassword, user.id]);

        // Log the password reset
        await req.db.run(`
            INSERT INTO audit_log (user_id, action, details, ip_address)
            VALUES (?, ?, ?, ?)
        `, [user.id, 'PASSWORD_RESET_COMPLETED', `Password reset completed: ${user.email}`, req.ip]);

        res.json({ message: 'Password reset successfully' });

    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Password reset failed' });
    }
});

// Refresh token
router.post('/refresh-token', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        // Verify the current token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get fresh user data
        const user = await req.db.get('SELECT * FROM users WHERE id = ?', [decoded.userId]);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Generate new token
        const newToken = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                role: user.role,
                subscriptionPlan: user.subscription_plan
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        res.json({ token: newToken });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
});

module.exports = router;
