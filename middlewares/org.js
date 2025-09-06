const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Middleware to load organization data and check user membership
 * Expects orgId in params or body
 * Special handling for personal organizations
 */
const loadOrg = async (req, res, next) => {
  try {
    if (!req.userData) {
      return res.status(401).json({ 
        error: 'User authentication required',
        code: 'USER_REQUIRED'
      });
    }

    const orgId = req.params.orgId || req.body.orgId;
    
    if (!orgId) {
      return res.status(400).json({ 
        error: 'Organization ID required',
        code: 'ORG_ID_REQUIRED'
      });
    }

    // Load organization with members
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      include: {
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
        creator: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    });

    if (!org) {
      return res.status(404).json({ 
        error: 'Organization not found',
        code: 'ORG_NOT_FOUND'
      });
    }

    // Check if user is a member of this organization
    const membership = org.members.find(member => member.userId === req.userData.id);
    
    // Special case: if this is the user's personal org, they always have access
    const isPersonalOrg = org.slug === `user-${req.userData.id}`;
    
    if (!membership && org.createdBy !== req.userData.id && !isPersonalOrg) {
      return res.status(403).json({ 
        error: 'Access denied. You are not a member of this organization',
        code: 'ORG_ACCESS_DENIED'
      });
    }

    // Attach organization and membership data to request
    req.org = org;
    req.membership = membership || { role: 'owner' }; // Creator is considered owner
    req.isPersonalOrg = isPersonalOrg;
    next();
  } catch (error) {
    console.error('Load org middleware error:', error);
    return res.status(500).json({ 
      error: 'Failed to load organization data',
      code: 'ORG_LOAD_ERROR'
    });
  }
};

/**
 * Middleware to require specific role in organization
 */
const requireOrgRole = (requiredRoles) => {
  const roleHierarchy = {
    viewer: 0,
    editor: 1,
    admin: 2,
    owner: 3
  };

  return (req, res, next) => {
    if (!req.membership) {
      return res.status(403).json({ 
        error: 'Organization membership required',
        code: 'ORG_MEMBERSHIP_REQUIRED'
      });
    }

    const userRole = req.membership.role;
    const userRoleLevel = roleHierarchy[userRole] || 0;
    
    // Check if user has any of the required roles
    const hasRequiredRole = requiredRoles.some(role => {
      const requiredRoleLevel = roleHierarchy[role] || 0;
      return userRoleLevel >= requiredRoleLevel;
    });

    if (!hasRequiredRole) {
      return res.status(403).json({ 
        error: `Insufficient permissions. Required roles: ${requiredRoles.join(', ')}, Your role: ${userRole}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles,
        userRole
      });
    }

    next();
  };
};

/**
 * Middleware to require organization ownership
 */
const requireOrgOwnership = (req, res, next) => {
  if (!req.org) {
    return res.status(400).json({ 
      error: 'Organization data required',
      code: 'ORG_DATA_REQUIRED'
    });
  }

  if (req.org.createdBy !== req.userData.id) {
    return res.status(403).json({ 
      error: 'Only organization owners can perform this action',
      code: 'OWNERSHIP_REQUIRED'
    });
  }

  next();
};

/**
 * Middleware to check if organization slug is available
 */
const checkOrgSlugAvailability = async (req, res, next) => {
  try {
    const { slug } = req.body;
    
    if (!slug) {
      return next(); // Let validation handle missing slug
    }

    const existingOrg = await prisma.org.findUnique({
      where: { slug: slug.toLowerCase() }
    });

    if (existingOrg) {
      return res.status(409).json({ 
        error: 'Organization slug already exists',
        code: 'SLUG_EXISTS',
        slug
      });
    }

    next();
  } catch (error) {
    console.error('Check org slug availability error:', error);
    return res.status(500).json({ 
      error: 'Failed to check slug availability',
      code: 'SLUG_CHECK_ERROR'
    });
  }
};

module.exports = {
  loadOrg,
  requireOrgRole,
  requireOrgOwnership,
  checkOrgSlugAvailability
};
