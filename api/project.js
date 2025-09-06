const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middlewares/auth');
const { loadUser } = require('../middlewares/user');
const { loadOrg, requireOrgRole } = require('../middlewares/org');

const router = express.Router();
const prisma = new PrismaClient();

// Apply authentication to all project routes
router.use(authenticateToken);
router.use(loadUser);

/**
 * POST /api/org/:orgId/projects
 * Create a new project
 */
router.post('/:orgId/projects', [
  loadOrg,
  requireOrgRole(['editor', 'admin', 'owner']),
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Project name must be between 1 and 100 characters'),
  body('slug')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must be 3-50 characters, lowercase letters, numbers, and hyphens only'),
  body('visibility')
    .optional()
    .isIn(['private', 'unlisted', 'public'])
    .withMessage('Visibility must be private, unlisted, or public')
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

    const { name, slug, visibility = 'private' } = req.body;

    // Check if slug is already taken in this organization
    const existingProject = await prisma.project.findUnique({
      where: {
        orgId_slug: {
          orgId: req.org.id,
          slug: slug.toLowerCase()
        }
      }
    });

    if (existingProject) {
      return res.status(409).json({
        success: false,
        error: 'Project slug already exists in this organization',
        code: 'SLUG_EXISTS'
      });
    }

    const project = await prisma.project.create({
      data: {
        name,
        slug: slug.toLowerCase(),
        visibility,
        orgId: req.org.id,
        createdBy: req.userData.id
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
      }
    });

    res.status(201).json({
      success: true,
      data: project,
      message: 'Project created successfully'
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
      code: 'PROJECT_CREATE_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/projects
 * Get all projects in organization
 */
router.get('/:orgId/projects', [loadOrg, requireOrgRole(['viewer', 'editor', 'admin', 'owner'])], async (req, res) => {
  try {
    const { page = 1, limit = 20, visibility } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      orgId: req.org.id
    };

    if (visibility) {
      where.visibility = visibility;
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
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
        orderBy: { updatedAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.project.count({ where })
    ]);

    res.json({
      success: true,
      data: projects,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects',
      code: 'PROJECTS_FETCH_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/projects/:projectId
 * Get project details
 */
router.get('/:orgId/projects/:projectId', [loadOrg, requireOrgRole(['viewer', 'editor', 'admin', 'owner'])], async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
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
        environments: {
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            environments: true,
            ops: true
          }
        }
      }
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project',
      code: 'PROJECT_FETCH_ERROR'
    });
  }
});

/**
 * PUT /api/org/:orgId/projects/:projectId
 * Update project details
 */
router.put('/:orgId/projects/:projectId', [
  loadOrg,
  requireOrgRole(['editor', 'admin', 'owner']),
  body('name')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Project name must be between 1 and 100 characters'),
  body('slug')
    .optional()
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must be 3-50 characters, lowercase letters, numbers, and hyphens only'),
  body('visibility')
    .optional()
    .isIn(['private', 'unlisted', 'public'])
    .withMessage('Visibility must be private, unlisted, or public')
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

    const { projectId } = req.params;
    const { name, slug, visibility } = req.body;

    // Check if project exists and user has access
    const existingProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!existingProject) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    const updateData = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (slug !== undefined && slug !== existingProject.slug) {
      // Check if new slug is available in this organization
      const slugExists = await prisma.project.findUnique({
        where: {
          orgId_slug: {
            orgId: req.org.id,
            slug: slug.toLowerCase()
          }
        }
      });

      if (slugExists) {
        return res.status(409).json({
          success: false,
          error: 'Project slug already exists in this organization',
          code: 'SLUG_EXISTS'
        });
      }

      updateData.slug = slug.toLowerCase();
    }

    if (visibility !== undefined) {
      updateData.visibility = visibility;
    }

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
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
      }
    });

    res.json({
      success: true,
      data: updatedProject,
      message: 'Project updated successfully'
    });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update project',
      code: 'PROJECT_UPDATE_ERROR'
    });
  }
});

/**
 * DELETE /api/org/:orgId/projects/:projectId
 * Delete project
 */
router.delete('/:orgId/projects/:projectId', [loadOrg, requireOrgRole(['admin', 'owner'])], async (req, res) => {
  try {
    const { projectId } = req.params;

    // Check if project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    await prisma.project.delete({
      where: { id: projectId }
    });

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project',
      code: 'PROJECT_DELETE_ERROR'
    });
  }
});

module.exports = router;