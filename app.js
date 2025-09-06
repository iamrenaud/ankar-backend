require('dotenv').config();
const express = require('express');
const { serve } = require("inngest/express");
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { functions } = require('./utility/ai/ai-functions');
const { inngest } = require('./lib/inngest');

// Import API routes
const userRoutes = require('./api/user');
const orgRoutes = require('./api/org');
const projectRoutes = require('./api/project');
const billingRoutes = require('./api/billing');
const conversationRoutes = require('./api/conversation');

const app = express();

// set trust proxy: 2 for DigitalOcean
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 2);
}

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
    }
});

app.use(limiter);

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true}));
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API routes
app.use('/api/user', userRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/org', projectRoutes); // Projects are nested under orgs
app.use('/api/org', billingRoutes); // Billing is nested under orgs
app.use('/api/org', conversationRoutes); // AI conversations are nested under orgs

// Inngest webhook endpoint
app.use('/api/inngest', serve({ client: inngest, functions }));

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Ankar Backend API',
        version: '1.0.0',
        description: 'Organization-centric API where every user has a personal workspace',
        endpoints: {
            health: '/health',
            user: {
                profile: '/api/user/profile',
                workspace: '/api/user/workspace',
                projects: '/api/user/projects',
                organizations: '/api/user/organizations'
            },
            organizations: {
                create: 'POST /api/org',
                get: 'GET /api/org/:orgId',
                update: 'PUT /api/org/:orgId',
                delete: 'DELETE /api/org/:orgId',
                members: 'GET /api/org/:orgId/members',
                addMember: 'POST /api/org/:orgId/members',
                updateMember: 'PUT /api/org/:orgId/members/:userId',
                removeMember: 'DELETE /api/org/:orgId/members/:userId',
                leave: 'POST /api/org/:orgId/leave'
            },
            projects: {
                create: 'POST /api/org/:orgId/projects',
                list: 'GET /api/org/:orgId/projects',
                get: 'GET /api/org/:orgId/projects/:projectId',
                update: 'PUT /api/org/:orgId/projects/:projectId',
                delete: 'DELETE /api/org/:orgId/projects/:projectId'
            },
            billing: {
                get: 'GET /api/org/:orgId/billing',
                setup: 'POST /api/org/:orgId/billing/setup',
                usage: 'GET /api/org/:orgId/billing/usage',
                payments: 'GET /api/org/:orgId/billing/payments'
            },
            ai: {
                chat: 'POST /api/org/:orgId/projects/:projectId/ai/chat (Intelligent routing - handles all AI interactions)',
                conversations: 'GET /api/org/:orgId/projects/:projectId/ai/conversations',
                getConversation: 'GET /api/org/:orgId/projects/:projectId/ai/conversations/:conversationId',
                addMessage: 'POST /api/org/:orgId/projects/:projectId/ai/conversations/:conversationId/messages',
                legacy: {
                    buildFragment: 'POST /api/org/:orgId/projects/:projectId/ai/build-fragment (Legacy)',
                    updateFragment: 'POST /api/org/:orgId/projects/:projectId/ai/update-fragment (Legacy)',
                    fixErrors: 'POST /api/org/:orgId/projects/:projectId/ai/fix-errors (Legacy)'
                }
            }
        },
        notes: [
            'Every user automatically gets a personal organization (workspace)',
            'Personal organizations have slug format: user-{userId}',
            'Personal organizations cannot be deleted',
            'All operations are organization-scoped'
        ]
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: req.originalUrl
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    res.status(err.status || 500).json({
        error: isDevelopment ? err.message : 'Internal server error',
        code: err.code || 'INTERNAL_ERROR',
        ...(isDevelopment && { stack: err.stack })
    });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`🚀 Server is running on port ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
    console.log(`🔗 API docs: http://localhost:${port}/`);
});

