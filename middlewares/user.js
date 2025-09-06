const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Middleware to load user data from database and attach to request
 * Automatically creates a personal organization if user doesn't have one
 * Requires authentication middleware to be run first
 */
const loadUser = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        error: 'User authentication required',
        code: 'USER_REQUIRED'
      });
    }

    // Load user from database
    let user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        orgsCreated: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true
          }
        },
        memberOf: {
          include: {
            org: {
              select: {
                id: true,
                name: true,
                slug: true,
                createdAt: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      // Create user if they don't exist (first time login)
      user = await prisma.user.create({
        data: {
          id: req.user.id,
          email: req.user.email,
          displayName: req.user.email.split('@')[0] // Use email prefix as default name
        },
        include: {
          orgsCreated: {
            select: {
              id: true,
              name: true,
              slug: true,
              createdAt: true
            }
          },
          memberOf: {
            include: {
              org: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  createdAt: true
                }
              }
            }
          }
        }
      });
    }

    // Ensure user has a personal organization
    let personalOrg = user.orgsCreated.find(org => org.slug === `user-${user.id}`);
    
    if (!personalOrg) {
      // Create personal organization for the user
      personalOrg = await prisma.org.create({
        data: {
          name: `${user.displayName || user.email.split('@')[0]}'s Workspace`,
          slug: `user-${user.id}`,
          createdBy: user.id
        },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true
        }
      });

      // Reload user with the new organization
      user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          orgsCreated: {
            select: {
              id: true,
              name: true,
              slug: true,
              createdAt: true
            }
          },
          memberOf: {
            include: {
              org: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  createdAt: true
                }
              }
            }
          }
        }
      });
    }

    // Attach user data and personal org to request
    req.userData = user;
    req.personalOrg = personalOrg;
    next();
  } catch (error) {
    console.error('Load user middleware error:', error);
    return res.status(500).json({ 
      error: 'Failed to load user data',
      code: 'USER_LOAD_ERROR'
    });
  }
};

/**
 * Middleware to ensure user has a specific plan or higher
 */
const requirePlan = (requiredPlan) => {
  const planHierarchy = {
    free: 0,
    pro: 1,
    teams: 2
  };

  return (req, res, next) => {
    if (!req.userData) {
      return res.status(401).json({ 
        error: 'User data required',
        code: 'USER_DATA_REQUIRED'
      });
    }

    const userPlanLevel = planHierarchy[req.userData.plan] || 0;
    const requiredPlanLevel = planHierarchy[requiredPlan] || 0;

    if (userPlanLevel < requiredPlanLevel) {
      return res.status(403).json({ 
        error: `Plan upgrade required. Current plan: ${req.userData.plan}, Required: ${requiredPlan}`,
        code: 'PLAN_UPGRADE_REQUIRED',
        currentPlan: req.userData.plan,
        requiredPlan: requiredPlan
      });
    }

    next();
  };
};

/**
 * Middleware to check if user is the owner of a resource
 */
const requireOwnership = (resourceIdParam = 'id') => {
  return (req, res, next) => {
    if (!req.userData) {
      return res.status(401).json({ 
        error: 'User data required',
        code: 'USER_DATA_REQUIRED'
      });
    }

    const resourceId = req.params[resourceIdParam];
    
    if (!resourceId) {
      return res.status(400).json({ 
        error: 'Resource ID required',
        code: 'RESOURCE_ID_REQUIRED'
      });
    }

    // This will be used in combination with other middlewares
    // that load the actual resource and check ownership
    req.resourceId = resourceId;
    next();
  };
};

module.exports = {
  loadUser,
  requirePlan,
  requireOwnership
};
