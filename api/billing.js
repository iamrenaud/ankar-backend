const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middlewares/auth');
const { loadUser } = require('../middlewares/user');
const { loadOrg, requireOrgRole } = require('../middlewares/org');

const router = express.Router();
const prisma = new PrismaClient();

// Apply authentication to all billing routes
router.use(authenticateToken);
router.use(loadUser);

/**
 * GET /api/org/:orgId/billing
 * Get organization billing information
 */
router.get('/:orgId/billing', [loadOrg, requireOrgRole(['admin', 'owner'])], async (req, res) => {
  try {
    const billing = await prisma.billingCustomer.findUnique({
      where: { orgId: req.org.id },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    // Get recent payments
    const payments = await prisma.payment.findMany({
      where: { orgId: req.org.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Get usage counters for current month
    const currentDate = new Date();
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const usage = await prisma.usageCounter.findMany({
      where: {
        orgId: req.org.id,
        window: {
          gte: startOfMonth
        }
      }
    });

    res.json({
      success: true,
      data: {
        billing,
        payments,
        usage
      }
    });
  } catch (error) {
    console.error('Get billing info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch billing information',
      code: 'BILLING_FETCH_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/billing/setup
 * Setup billing for organization
 */
router.post('/:orgId/billing/setup', [
  loadOrg,
  requireOrgRole(['admin', 'owner']),
  body('provider')
    .optional()
    .isIn(['stripe'])
    .withMessage('Provider must be stripe'),
  body('externalId')
    .isLength({ min: 1, max: 200 })
    .withMessage('External ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }

    const { provider = 'stripe', externalId } = req.body;

    // Check if billing is already setup
    const existingBilling = await prisma.billingCustomer.findUnique({
      where: { orgId: req.org.id }
    });

    if (existingBilling) {
      return res.status(409).json({
        success: false,
        error: 'Billing is already setup for this organization',
        code: 'BILLING_ALREADY_SETUP'
      });
    }

    const billing = await prisma.billingCustomer.create({
      data: {
        orgId: req.org.id,
        provider,
        externalId
      },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: billing,
      message: 'Billing setup completed successfully'
    });
  } catch (error) {
    console.error('Setup billing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to setup billing',
      code: 'BILLING_SETUP_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/billing/usage
 * Get organization usage statistics
 */
router.get('/:orgId/billing/usage', [loadOrg, requireOrgRole(['viewer', 'editor', 'admin', 'owner'])], async (req, res) => {
  try {
    const { period = 'month', metric } = req.query;
    
    let startDate;
    const endDate = new Date();
    
    switch (period) {
      case 'day':
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(endDate.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    }

    const where = {
      orgId: req.org.id,
      window: {
        gte: startDate,
        lte: endDate
      }
    };

    if (metric) {
      where.metric = metric;
    }

    const usage = await prisma.usageCounter.findMany({
      where,
      orderBy: { window: 'desc' }
    });

    // Aggregate usage by metric
    const aggregatedUsage = usage.reduce((acc, item) => {
      if (!acc[item.metric]) {
        acc[item.metric] = 0;
      }
      acc[item.metric] += Number(item.value);
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        usage: aggregatedUsage,
        detailed: usage
      }
    });
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage statistics',
      code: 'USAGE_FETCH_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/billing/usage
 * Record usage for organization
 */
router.post('/:orgId/billing/usage', [
  loadOrg,
  requireOrgRole(['admin', 'owner']),
  body('metric')
    .isLength({ min: 1, max: 50 })
    .withMessage('Metric is required and must be 1-50 characters'),
  body('value')
    .isInt({ min: 0 })
    .withMessage('Value must be a non-negative integer'),
  body('window')
    .optional()
    .isISO8601()
    .withMessage('Window must be a valid ISO date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }

    const { metric, value, window } = req.body;
    
    // Use current date if window not provided
    const usageWindow = window ? new Date(window) : new Date();
    // Set to UTC midnight
    usageWindow.setUTCHours(0, 0, 0, 0);

    // Upsert usage counter
    const usage = await prisma.usageCounter.upsert({
      where: {
        orgId_metric_window: {
          orgId: req.org.id,
          metric,
          window: usageWindow
        }
      },
      update: {
        value: {
          increment: BigInt(value)
        }
      },
      create: {
        orgId: req.org.id,
        metric,
        window: usageWindow,
        value: BigInt(value)
      }
    });

    res.json({
      success: true,
      data: usage,
      message: 'Usage recorded successfully'
    });
  } catch (error) {
    console.error('Record usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record usage',
      code: 'USAGE_RECORD_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/billing/payments
 * Get organization payment history
 */
router.get('/:orgId/billing/payments', [loadOrg, requireOrgRole(['admin', 'owner'])], async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      orgId: req.org.id
    };

    if (type) {
      where.type = type;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.payment.count({ where })
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payments',
      code: 'PAYMENTS_FETCH_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/billing/payments
 * Record a payment
 */
router.post('/:orgId/billing/payments', [
  loadOrg,
  requireOrgRole(['admin', 'owner']),
  body('type')
    .isIn(['subscription', 'topup'])
    .withMessage('Type must be subscription or topup'),
  body('amount')
    .isInt({ min: 1 })
    .withMessage('Amount must be a positive integer (in cents)'),
  body('currency')
    .optional()
    .isLength({ min: 3, max: 3 })
    .withMessage('Currency must be 3 characters'),
  body('externalId')
    .isLength({ min: 1, max: 200 })
    .withMessage('External ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }

    const { type, amount, currency = 'USD', externalId } = req.body;

    const payment = await prisma.payment.create({
      data: {
        orgId: req.org.id,
        type,
        amount,
        currency,
        externalId
      }
    });

    res.status(201).json({
      success: true,
      data: payment,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record payment',
      code: 'PAYMENT_RECORD_ERROR'
    });
  }
});

/**
 * DELETE /api/org/:orgId/billing
 * Remove billing setup
 */
router.delete('/:orgId/billing', [loadOrg, requireOrgOwnership], async (req, res) => {
  try {
    await prisma.billingCustomer.delete({
      where: { orgId: req.org.id }
    });

    res.json({
      success: true,
      message: 'Billing setup removed successfully'
    });
  } catch (error) {
    console.error('Remove billing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove billing setup',
      code: 'BILLING_REMOVE_ERROR'
    });
  }
});

module.exports = router;