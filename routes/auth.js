import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiter for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs (e.g. 100 login/register attempts per 15 mins)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply the limiter to all routes in this router, or specific ones if needed
// For broader protection, it's often applied to all auth routes.
// If specific routes need different limits, create separate limiters.
router.use(authLimiter); // Apply to all /auth routes

// Middleware to protect routes
export const protect = async (req, res, next) => {
    let tokenToVerify;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            
            // Check if the token is missing or is a string like 'null' or 'undefined'
            if (!token || token === 'null' || token === 'undefined') {
                return res.status(401).json({ message: 'Not authorized, token is malformed or missing' });
            }
            tokenToVerify = token;

            const decoded = jwt.verify(tokenToVerify, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user) {
                return res.status(401).json({ message: 'Not authorized, user not found' });
            }
            next();
        } catch (error) {
            console.error(error); // Log the actual error for server-side debugging
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({ message: 'Not authorized, token is invalid' });
            } else if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Not authorized, token has expired' });
            }
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    } else { // This else corresponds to the outer if, handles missing Bearer or no auth header
        return res.status(401).json({ message: 'Not authorized, no token provided' });
    }
    // Note: The `if (!token)` check that was previously at the end is effectively covered by the logic above.
    // If tokenToVerify was never assigned (e.g. no auth header or not Bearer), the else block above handles it.
};

// Middleware to protect admin routes
export const adminProtect = (req, res, next) => {
    protect(req, res, () => { // Call the base protect middleware
        if (req.user && req.user.role === 'admin') {
            next(); // User is admin, proceed
        } else {
            // If req.user is not set by protect, it means protect already sent a response.
            // If req.user is set but role is not admin, then send 403 Forbidden.
            if (res.headersSent) return; // Avoid sending multiple responses if protect already did
            res.status(403).json({ message: 'Not authorized, admin role required' });
        }
    });
};

// @route   POST /auth/register
// @desc    Register a new user
// @access  Public
router.post('/register',
    [
        body('email', 'Please include a valid email').isEmail(),
        body('password', 'Password must be 6 or more characters').isLength({ min: 6 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        try {
            let user = await User.findOne({ email });
            if (user) {
                return res.status(400).json({ message: 'User already exists' });
            }

            user = new User({
                email,
                password
            });

            await user.save();
            res.status(201).json({ message: 'User registered successfully. Please login.' });

        } catch (err) {
            console.error(err.message);
            res.status(500).send('Server error');
        }
    }
);

// @route   POST /auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login',
    [
        body('email', 'Please include a valid email').isEmail(),
        body('password', 'Password is required').exists()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        try {
            let user = await User.findOne({ email }).select('+password');
            if (!user) {
                return res.status(400).json({ message: 'Invalid credentials' });
            }

            const isMatch = await user.matchPassword(password);
            if (!isMatch) {
                return res.status(400).json({ message: 'Invalid credentials' });
            }

            // Check if user is verified
            if (!user.isVerified) {
                return res.status(401).json({ message: 'Account not verified. Please wait for admin approval.' });
            }

            const payload = {
                id: user.id,
                email: user.email
            };

            jwt.sign(
                payload,
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '1h' },
                (err, token) => {
                    if (err) throw err;
                    res.json({ token });
                }
            );

        } catch (err) {
            console.error(err.message);
            res.status(500).send('Server error');
        }
    }
);

// @route   GET /auth/status
// @desc    Check if user is logged in and get user data
// @access  Private
router.get('/status', protect, async (req, res) => {
    // req.user is populated by the protect middleware and already excludes the password.
    // We need to ensure isVerified is selected if it wasn't by default or by protect.
    // However, User.findById in protect should fetch the whole document by default (minus fields with select: false)
    // and our User model doesn't have select: false on isVerified.
    
    // Let's ensure we have the latest user data for verification status.
    const user = await User.findById(req.user.id);
    if (!user) { // Should not happen if protect succeeded, but as a safeguard
        return res.status(401).json({ loggedIn: false, message: 'User not found.'});
    }

    if (!user.isVerified) {
        // User is authenticated (valid token) but not verified.
        // Client needs to know this to display appropriate UI.
        return res.json({ loggedIn: true, isVerified: false, email: user.email, userId: user._id, message: 'Account pending verification.' });
    }

    // If protect middleware passes AND user is verified, user is fully authorized
    res.json({ loggedIn: true, isVerified: true, email: user.email, userId: user._id });
});

// @route   POST /auth/logout
// @desc    Log user out
// @access  Private
router.post('/logout', protect, (req, res) => {
    res.status(200).json({ message: 'Logout successful' });
});

export default router; 