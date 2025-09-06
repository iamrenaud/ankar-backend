const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middlewares/auth');
const { loadUser } = require('../middlewares/user');
const { 
  loadOrg, 
  requireOrgRole, 
  requireOrgOwnership, 
  checkOrgSlugAvailability 
} = require('../middlewares/org');

const router = express.Router();
const prisma = new PrismaClient();

// Apply authentication to all org routes
router.use(authenticateToken);
router.use(loadUser);

/**
 * POST /api/org
 * Create a new organization
 */
router.post('/', [
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Organization name must be between 1 and 100 characters'),
  body('slug')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must be 3-50 characters, lowercase letters, numbers, and hyphens only'),
  checkOrgSlugAvailability
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

    const { name, slug } = req.body;

    const org = await prisma.org.create({
      data: {
        name,
        slug: slug.toLowerCase(),
        createdBy: req.userData.id
      },
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
            members: true,
            projects: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: org,
      message: 'Organization created successfully'
    });
  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create organization',
      code: 'ORG_CREATE_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId
 * Get organization details
 */
router.get('/:orgId', loadOrg, async (req, res) => {
  try {
    res.json({
      success: true,
      data: req.org
    });
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch organization',
      code: 'ORG_FETCH_ERROR'
    });
  }
});

/**
 * PUT /api/org/:orgId
 * Update organization details
 */
router.put('/:orgId', [
  loadOrg,
  requireOrgRole(['admin', 'owner']),
  body('name')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Organization name must be between 1 and 100 characters'),
  body('slug')
    .optional()
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must be 3-50 characters, lowercase letters, numbers, and hyphens only')
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

    const { name, slug } = req.body;
    const updateData = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (slug !== undefined && slug !== req.org.slug) {
      // Check if new slug is available
      const existingOrg = await prisma.org.findUnique({
        where: { slug: slug.toLowerCase() }
      });

      if (existingOrg) {
        return res.status(409).json({
          success: false,
          error: 'Organization slug already exists',
          code: 'SLUG_EXISTS'
        });
      }

      updateData.slug = slug.toLowerCase();
    }

    const updatedOrg = await prisma.org.update({
      where: { id: req.org.id },
      data: updateData,
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
      }
    });

    res.json({
      success: true,
      data: updatedOrg,
      message: 'Organization updated successfully'
    });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update organization',
      code: 'ORG_UPDATE_ERROR'
    });
  }
});

/**
 * DELETE /api/org/:orgId
 * Delete organization (only owner can delete, but not personal orgs)
 */
router.delete('/:orgId', [loadOrg, requireOrgOwnership], async (req, res) => {
  try {
    // Prevent deletion of personal organizations
    if (req.isPersonalOrg) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete personal workspace. Personal organizations are permanent.',
        code: 'PERSONAL_ORG_DELETE_FORBIDDEN'
      });
    }

    await prisma.org.delete({
      where: { id: req.org.id }
    });

    res.json({
      success: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete organization',
      code: 'ORG_DELETE_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/members
 * Get organization members
 */
router.get('/:orgId/members', loadOrg, async (req, res) => {
  try {
    const members = await prisma.orgMember.findMany({
      where: { orgId: req.org.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            createdAt: true
          }
        }
      },
      orderBy: { addedAt: 'asc' }
    });

    // Add creator as owner
    const creator = {
      orgId: req.org.id,
      userId: req.org.createdBy,
      role: 'owner',
      addedAt: req.org.createdAt,
      user: req.org.creator
    };

    const allMembers = [creator, ...members];

    res.json({
      success: true,
      data: allMembers
    });
  } catch (error) {
    console.error('Get organization members error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch members',
      code: 'MEMBERS_FETCH_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/members
 * Add member to organization
 */
router.post('/:orgId/members', [
  loadOrg,
  requireOrgRole(['admin', 'owner']),
  body('email')
    .isEmail()
    .withMessage('Invalid email format'),
  body('role')
    .isIn(['viewer', 'editor', 'admin'])
    .withMessage('Role must be viewer, editor, or admin')
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

    const { email, role } = req.body;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user is already a member
    const existingMember = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: req.org.id,
          userId: user.id
        }
      }
    });

    if (existingMember) {
      return res.status(409).json({
        success: false,
        error: 'User is already a member of this organization',
        code: 'ALREADY_MEMBER'
      });
    }

    // Add member
    const member = await prisma.orgMember.create({
      data: {
        orgId: req.org.id,
        userId: user.id,
        role
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: member,
      message: 'Member added successfully'
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add member',
      code: 'MEMBER_ADD_ERROR'
    });
  }
});

/**
 * PUT /api/org/:orgId/members/:userId
 * Update member role
 */
router.put('/:orgId/members/:userId', [
  loadOrg,
  requireOrgRole(['admin', 'owner']),
  body('role')
    .isIn(['viewer', 'editor', 'admin'])
    .withMessage('Role must be viewer, editor, or admin')
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

    const { userId } = req.params;
    const { role } = req.body;

    // Can't change owner's role
    if (userId === req.org.createdBy) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change owner role',
        code: 'OWNER_ROLE_IMMUTABLE'
      });
    }

    const updatedMember = await prisma.orgMember.update({
      where: {
        orgId_userId: {
          orgId: req.org.id,
          userId
        }
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: updatedMember,
      message: 'Member role updated successfully'
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update member role',
      code: 'MEMBER_UPDATE_ERROR'
    });
  }
});

/**
 * DELETE /api/org/:orgId/members/:userId
 * Remove member from organization
 */
router.delete('/:orgId/members/:userId', [loadOrg, requireOrgRole(['admin', 'owner'])], async (req, res) => {
  try {
    const { userId } = req.params;

    // Can't remove owner
    if (userId === req.org.createdBy) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove organization owner',
        code: 'OWNER_REMOVAL_FORBIDDEN'
      });
    }

    await prisma.orgMember.delete({
      where: {
        orgId_userId: {
          orgId: req.org.id,
          userId
        }
      }
    });

    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member',
      code: 'MEMBER_REMOVE_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/leave
 * Leave organization
 */
router.post('/:orgId/leave', [loadOrg], async (req, res) => {
  try {
    // Can't leave if you're the owner
    if (req.org.createdBy === req.userData.id) {
      return res.status(400).json({
        success: false,
        error: 'Organization owner cannot leave. Transfer ownership or delete organization instead.',
        code: 'OWNER_CANNOT_LEAVE'
      });
    }

    // Check if user is a member
    if (!req.membership) {
      return res.status(400).json({
        success: false,
        error: 'You are not a member of this organization',
        code: 'NOT_MEMBER'
      });
    }

    await prisma.orgMember.delete({
      where: {
        orgId_userId: {
          orgId: req.org.id,
          userId: req.userData.id
        }
      }
    });

    res.json({
      success: true,
      message: 'Left organization successfully'
    });
  } catch (error) {
    console.error('Leave organization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to leave organization',
      code: 'LEAVE_ORG_ERROR'
    });
  }
});

module.exports = router;