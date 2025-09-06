const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middlewares/auth');
const { loadOrg, requireOrgRole } = require('../middlewares/org');
const { inngest } = require('../lib/inngest');

const prisma = new PrismaClient();

// Apply authentication and organization middleware to all routes
router.use(authenticateToken);
router.use(loadOrg);
router.use(requireOrgRole(['viewer', 'editor', 'admin', 'owner']));

/**
 * POST /api/org/:orgId/projects/:projectId/ai/chat
 * Intelligent AI conversation endpoint that routes to appropriate agents
 */
router.post('/:orgId/projects/:projectId/ai/chat', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        code: 'INVALID_MESSAGE'
      });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Create conversation record
    const conversation = await prisma.conversation.create({
      data: {
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id,
        title: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        status: 'active'
      }
    });

    // Create initial message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message,
        metadata: context ? { context } : null
      }
    });

    // Trigger intelligent AI processing (routes automatically)
    await inngest.send({
      name: 'ankar.ai/process-message',
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id,
        message: message,
        context: context,
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id
      }
    });

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        createdAt: conversation.createdAt
      },
      message: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt
      }
    });

  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({
      error: 'Failed to start AI conversation',
      code: 'AI_CHAT_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/projects/:projectId/ai/build-fragment
 * Build a new code fragment using AI (Legacy endpoint - use /ai/chat for intelligent routing)
 */
router.post('/:orgId/projects/:projectId/ai/build-fragment', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, templateName } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        code: 'INVALID_MESSAGE'
      });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Create conversation record for fragment building
    const conversation = await prisma.conversation.create({
      data: {
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id,
        title: `Build Fragment: ${message.substring(0, 50)}...`,
        status: 'processing',
        type: 'fragment_build'
      }
    });

    // Create initial message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message,
        metadata: { templateName: templateName || 'default' }
      }
    });

    // Trigger AI fragment building
    await inngest.send({
      name: 'ankar.ai/build-initial-fragment',
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id,
        message: message,
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id,
        templateName: templateName || 'default'
      }
    });

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        type: conversation.type,
        createdAt: conversation.createdAt
      },
      message: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt
      }
    });

  } catch (error) {
    console.error('AI build fragment error:', error);
    res.status(500).json({
      error: 'Failed to start fragment building',
      code: 'AI_BUILD_FRAGMENT_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/projects/:projectId/ai/update-fragment
 * Update an existing code fragment using AI (Legacy endpoint - use /ai/chat for intelligent routing)
 */
router.post('/:orgId/projects/:projectId/ai/update-fragment', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, conversationId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        code: 'INVALID_MESSAGE'
      });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // If conversationId provided, use existing conversation
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          projectId: projectId,
          orgId: req.org.id
        }
      });

      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found',
          code: 'CONVERSATION_NOT_FOUND'
        });
      }
    } else {
      // Create new conversation for fragment update
      conversation = await prisma.conversation.create({
        data: {
          projectId: projectId,
          orgId: req.org.id,
          userId: req.userData.id,
          title: `Update Fragment: ${message.substring(0, 50)}...`,
          status: 'processing',
          type: 'fragment_update'
        }
      });
    }

    // Create user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message
      }
    });

    // Trigger AI fragment update
    await inngest.send({
      name: 'ankar.ai/update-existing-fragment',
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id,
        message: message,
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id
      }
    });

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        type: conversation.type,
        createdAt: conversation.createdAt
      },
      message: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt
      }
    });

  } catch (error) {
    console.error('AI update fragment error:', error);
    res.status(500).json({
      error: 'Failed to start fragment update',
      code: 'AI_UPDATE_FRAGMENT_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/projects/:projectId/ai/fix-errors
 * Fix errors in existing code using AI (Legacy endpoint - use /ai/chat for intelligent routing)
 */
router.post('/:orgId/projects/:projectId/ai/fix-errors', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, conversationId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        code: 'INVALID_MESSAGE'
      });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // If conversationId provided, use existing conversation
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          projectId: projectId,
          orgId: req.org.id
        }
      });

      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found',
          code: 'CONVERSATION_NOT_FOUND'
        });
      }
    } else {
      // Create new conversation for error fixing
      conversation = await prisma.conversation.create({
        data: {
          projectId: projectId,
          orgId: req.org.id,
          userId: req.userData.id,
          title: `Fix Errors: ${message.substring(0, 50)}...`,
          status: 'processing',
          type: 'error_fix'
        }
      });
    }

    // Create user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message
      }
    });

    // Trigger AI error fixing
    await inngest.send({
      name: 'ankar.ai/fix-errors-in-existing-fragment',
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id,
        message: message,
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id
      }
    });

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        type: conversation.type,
        createdAt: conversation.createdAt
      },
      message: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt
      }
    });

  } catch (error) {
    console.error('AI fix errors error:', error);
    res.status(500).json({
      error: 'Failed to start error fixing',
      code: 'AI_FIX_ERRORS_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/projects/:projectId/ai/conversations
 * Get all AI conversations for a project
 */
router.get('/:orgId/projects/:projectId/ai/conversations', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Build where clause
    const where = {
      projectId: projectId,
      orgId: req.org.id
    };

    if (type) {
      where.type = type;
    }

    // Get conversations with pagination
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          },
          user: {
            select: {
              id: true,
              email: true,
              displayName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit)
      }),
      prisma.conversation.count({ where })
    ]);

    res.json({
      success: true,
      conversations: conversations.map(conv => ({
        id: conv.id,
        title: conv.title,
        status: conv.status,
        type: conv.type,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        lastMessage: conv.messages[0] ? {
          id: conv.messages[0].id,
          role: conv.messages[0].role,
          content: conv.messages[0].content.substring(0, 200) + (conv.messages[0].content.length > 200 ? '...' : ''),
          createdAt: conv.messages[0].createdAt
        } : null,
        user: conv.user
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      error: 'Failed to get conversations',
      code: 'GET_CONVERSATIONS_ERROR'
    });
  }
});

/**
 * GET /api/org/:orgId/projects/:projectId/ai/conversations/:conversationId
 * Get a specific conversation with all messages
 */
router.get('/:orgId/projects/:projectId/ai/conversations/:conversationId', async (req, res) => {
  try {
    const { projectId, conversationId } = req.params;

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Get conversation with all messages
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        projectId: projectId,
        orgId: req.org.id
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        },
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found',
        code: 'CONVERSATION_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        type: conversation.type,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        user: conversation.user,
        messages: conversation.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata,
          createdAt: msg.createdAt
        }))
      }
    });

  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      error: 'Failed to get conversation',
      code: 'GET_CONVERSATION_ERROR'
    });
  }
});

/**
 * POST /api/org/:orgId/projects/:projectId/ai/conversations/:conversationId/messages
 * Add a new message to an existing conversation
 */
router.post('/:orgId/projects/:projectId/ai/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { projectId, conversationId } = req.params;
    const { message, context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        code: 'INVALID_MESSAGE'
      });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: req.org.id
      }
    });

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Verify conversation exists
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        projectId: projectId,
        orgId: req.org.id
      }
    });

    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found',
        code: 'CONVERSATION_NOT_FOUND'
      });
    }

    // Create new message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversationId,
        role: 'user',
        content: message,
        metadata: context ? { context } : null
      }
    });

    // Update conversation status
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { 
        status: 'processing',
        updatedAt: new Date()
      }
    });

    // Trigger AI processing based on conversation type
    let eventName = 'ankar.ai/process-message';
    if (conversation.type === 'fragment_build') {
      eventName = 'ankar.ai/build-initial-fragment';
    } else if (conversation.type === 'fragment_update') {
      eventName = 'ankar.ai/update-existing-fragment';
    } else if (conversation.type === 'error_fix') {
      eventName = 'ankar.ai/fix-errors-in-existing-fragment';
    }

    await inngest.send({
      name: eventName,
      data: {
        conversationId: conversationId,
        messageId: userMessage.id,
        message: message,
        context: context,
        projectId: projectId,
        orgId: req.org.id,
        userId: req.userData.id
      }
    });

    res.status(201).json({
      success: true,
      message: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        metadata: userMessage.metadata,
        createdAt: userMessage.createdAt
      }
    });

  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({
      error: 'Failed to add message',
      code: 'ADD_MESSAGE_ERROR'
    });
  }
});

module.exports = router;
