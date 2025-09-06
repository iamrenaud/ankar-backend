const { createClient } = require('@supabase/supabase-js');
const supabase = require('../lib/supabase');

/**
 * Authentication middleware that verifies JWT tokens from Supabase
 * Expects Authorization header with "Bearer <token>" format
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        code: 'MISSING_TOKEN'
      });
    }

    // Verify the JWT token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }

    // Add user info to request object
    req.user = {
      id: user.id,
      email: user.email,
      token: token
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 * Useful for endpoints that work with or without authentication
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (!error && user) {
        req.user = {
          id: user.id,
          email: user.email,
          token: token
        };
      }
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    // Continue without authentication
    next();
  }
};

module.exports = {
  authenticateToken,
  optionalAuth
};
