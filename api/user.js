const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middlewares/auth');
const { loadUser, requirePlan } = require('../middlewares/user');

const router = express.Router();
const prisma = new PrismaClient();

// Apply authentication to all user routes
router.use(authenticateToken);
router.use(loadUser);

/**
 * GET /api/user/profile
 * Get current user profile with personal organization
 */
router.get('/profile', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userData.id },
      include: {
        orgsCreated: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
            _count: {
              select: {
                members: true,
                projects: true
              }
            }
          }
        },
        memberOf: {
          include: {
            org: {
              select: {
                id: true,
                name: true,
                slug: true,
                createdAt: true,
                _count: {
                  select: {
                    members: true,
                    projects: true
                  }
                }
              }
            }
          }
        }
      }
    });

    // Add personal org info to response
    const response = {
      ...user,
      personalOrg: req.personalOrg
    };

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
      code: 'PROFILE_FETCH_ERROR'
    });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile
 */
router.put('/profile', [
  body('displayName')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Display name must be between 1 and 100 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format')
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

    const { displayName, email } = req.body;
    const updateData = {};

    if (displayName !== undefined) {
      updateData.displayName = displayName;
    }

    if (email !== undefined && email !== req.userData.email) {
      // Check if email is already taken
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Email already exists',
          code: 'EMAIL_EXISTS'
        });
      }

      updateData.email = email;
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.userData.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        plan: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      data: updatedUser,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      code: 'PROFILE_UPDATE_ERROR'
    });
  }
});

/**
 * GET /api/user/organizations
 * Get all organizations user is part of
 */
router.get('/organizations', async (req, res) => {
  try {
    const organizations = await prisma.org.findMany({
      where: {
        OR: [
          { createdBy: req.userData.id },
          { members: { some: { userId: req.userData.id } } }
        ]
      },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            projects: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Add user's role in each organization
    const organizationsWithRole = organizations.map(org => {
      const membership = org.members.find(member => member.userId === req.userData.id);
      const role = org.createdBy === req.userData.id ? 'owner' : (membership?.role || null);
      
      return {
        ...org,
        userRole: role
      };
    });

    res.json({
      success: true,
      data: organizationsWithRole
    });
  } catch (error) {
    console.error('Get user organizations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch organizations',
      code: 'ORGS_FETCH_ERROR'
    });
  }
});

/**
 * GET /api/user/workspace
 * Get user's personal workspace (personal org with projects)
 */
router.get('/workspace', async (req, res) => {
  try {
    const workspace = await prisma.org.findUnique({
      where: { id: req.personalOrg.id },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        },
        projects: {
          include: {
            creator: {
              select: {
                id: true,
                email: true,
                displayName: true
              }
            },
            _count: {
              select: {
                environments: true
              }
            }
          },
          orderBy: { updatedAt: 'desc' }
        },
        _count: {
          select: {
            members: true,
            projects: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: workspace
    });
  } catch (error) {
    console.error('Get user workspace error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workspace',
      code: 'WORKSPACE_FETCH_ERROR'
    });
  }
});

/**
 * GET /api/user/projects
 * Get all projects user has access to across all organizations
 */
router.get('/projects', async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { createdBy: req.userData.id },
          { 
            org: {
              members: { some: { userId: req.userData.id } }
            }
          }
        ]
      },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        creator: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        },
        _count: {
          select: {
            environments: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    console.error('Get user projects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects',
      code: 'PROJECTS_FETCH_ERROR'
    });
  }
});

/**
 * POST /api/user/upgrade-plan
 * Upgrade user plan (placeholder for billing integration)
 */
router.post('/upgrade-plan', [
  body('plan')
    .isIn(['pro', 'teams'])
    .withMessage('Plan must be either "pro" or "teams"')
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

    const { plan } = req.body;

    // This is a placeholder - in a real implementation, you'd integrate with Stripe
    // and only update the plan after successful payment
    const updatedUser = await prisma.user.update({
      where: { id: req.userData.id },
      data: { plan },
      select: {
        id: true,
        email: true,
        displayName: true,
        plan: true
      }
    });

    res.json({
      success: true,
      data: updatedUser,
      message: `Plan upgraded to ${plan}`
    });
  } catch (error) {
    console.error('Upgrade plan error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upgrade plan',
      code: 'PLAN_UPGRADE_ERROR'
    });
  }
});

/**
 * DELETE /api/user/account
 * Delete user account (soft delete - just deactivate)
 */
router.delete('/account', async (req, res) => {
  try {
    // In a real implementation, you might want to:
    // 1. Cancel all subscriptions
    // 2. Transfer ownership of organizations
    // 3. Archive projects
    // 4. Send confirmation email
    
    // For now, we'll just update the email to mark as deleted
    const deletedEmail = `deleted_${Date.now()}_${req.userData.email}`;
    
    await prisma.user.update({
      where: { id: req.userData.id },
      data: { 
        email: deletedEmail,
        displayName: null
      }
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      code: 'ACCOUNT_DELETE_ERROR'
    });
  }
});

module.exports = router;