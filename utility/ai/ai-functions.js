const { createNetwork, createState } = require('@inngest/agent-kit');
const inngest = require('../../lib/inngest');
const agents = require('./ai-agents');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const buildInitialFragment = inngest.createFunction(
    { id: 'build-initial-fragment' },
    { event: 'ankar.ai/build-initial-fragment' },
    async ({event, step}) => {

        const network = createNetwork({
            name: 'coding-agent-network',
            agents: [
                ...agents.agents,
            ],
            maxIter: 25,
            router: async ({  network }) => {
                const summary = network.state.data.summary;
                if (summary) {
                    return ;
                }
                return network.agents;
            },
        });

        const result = await network.run(event.data.message);

        // Ensure containerPreviewURL is available in the final result
        const containerPreviewURL = result.state.data.containerPreviewURL || network.state.data.containerPreviewURL;

        return {
            url: containerPreviewURL,
            title: 'InitialFragment',
            summary: result.state.data.summary,
        };
    }
)

const updateExistingFragment = inngest.createFunction(
    { id: 'build-initial-fragment' },
    { event: 'ankar.ai/build-initial-fragment' },
    async ({event, step}) => {

        const previousMessages =  [{
            type: "text",
            role: "user",
            content: "build a beautiful landing page for a SaaS product",
        },
        {
            type: "text",
            role: "assistant",
            content: "<task_summary> Built a polished SaaS landing page in a Vite + React + TypeScript project with Tailwind. Implemented a full responsive layout: sticky Navbar with theme toggle, animated Hero, Features grid, dynamic Pricing with monthly/yearly switch (persisted in localStorage), auto-rotating Testimonials carousel with controls, interactive FAQ accordion, and CTA with validated email capture stored in localStorage, plus a comprehensive Footer. Ensured accessibility, dark mode support, smooth scrolling, and production-ready build. Development server started and preview link generated.</task_summary>",
        }];

        const state = createState({
            summary: "",
            files: {},
        },{
            messages: [],
        });


        const network = createNetwork({
            name: 'coding-agent-network',
            agents: [
                ...agents.agents,
            ],
            maxIter: 25,
            defaultState: state,
            router: async ({  network }) => {
                const summary = network.state.data.summary;
                if (summary) {
                    return ;
                }
                return network.agents;
            }
        });

        const result = await network.run(event.data.message, { state });

        // Ensure containerPreviewURL is available in the final result
        const containerPreviewURL = result.state.data.containerPreviewURL || network.state.data.containerPreviewURL;

        return {
            url: containerPreviewURL,
            title: 'Fragment',
            files: result.state.data.files,
            summary: result.state.data.summary,
        };
    }
)

const fixErrorsInExistingFragment = inngest.createFunction(
    { id: 'build-initial-fragment' },
    { event: 'ankar.ai/build-initial-fragment' },
    async ({event, step}) => {

        const previousMessages =  [{
            type: "text",
            role: "user",
            content: "build a beautiful landing page for a SaaS product",
        },
        {
            type: "text",
            role: "assistant",
            content: "<task_summary> Built a polished SaaS landing page in a Vite + React + TypeScript project with Tailwind. Implemented a full responsive layout: sticky Navbar with theme toggle, animated Hero, Features grid, dynamic Pricing with monthly/yearly switch (persisted in localStorage), auto-rotating Testimonials carousel with controls, interactive FAQ accordion, and CTA with validated email capture stored in localStorage, plus a comprehensive Footer. Ensured accessibility, dark mode support, smooth scrolling, and production-ready build. Development server started and preview link generated.</task_summary>",
        }];

        const state = createState({
            summary: "",
            files: {},
        },{
            messages: [],
        });


        const network = createNetwork({
            name: 'coding-agent-network',
            agents: [
                ...agents.agents,
            ],
            maxIter: 25,
            defaultState: state,
            router: async ({  network }) => {
                const summary = network.state.data.summary;
                if (summary) {
                    return ;
                }
                return network.agents;
            }
        });

        const result = await network.run(event.data.message, { state });

        // Ensure containerPreviewURL is available in the final result
        const containerPreviewURL = result.state.data.containerPreviewURL || network.state.data.containerPreviewURL;

        return {
            url: containerPreviewURL,
            title: 'Fragment',
            files: result.state.data.files,
            summary: result.state.data.summary,
        };
    }
)

// Intelligent routing function that determines conversation type
const processMessage = inngest.createFunction(
    { id: 'process-message' },
    { event: 'ankar.ai/process-message' },
    async ({event, step}) => {
        const { conversationId, messageId, message, projectId, orgId, userId } = event.data;

        // Create a simple network with just the general agent for routing
        const network = createNetwork({
            name: 'routing-network',
            agents: [agents.agents.find(agent => agent.name === 'general-agent')],
            maxIter: 1, // Only need one iteration for routing
        });

        // Get the general agent to determine conversation type
        const result = await network.run(message);

        const conversationType = result.state.data.conversationType;
        const routingReason = result.state.data.routingReason;
        const routingMessage = result.state.data.routingMessage;

        console.log(`Routing decision: ${conversationType} - ${routingReason}`);

        // Update conversation with routing information
        await step.run('update-conversation-type', async () => {
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { 
                    type: conversationType.toLowerCase(),
                    status: conversationType === 'GENERAL_CHAT' ? 'completed' : 'processing'
                }
            });
        });

        // Create assistant message with routing response
        await step.run('create-assistant-message', async () => {
            await prisma.message.create({
                data: {
                    conversationId: conversationId,
                    role: 'assistant',
                    content: routingMessage,
                    metadata: {
                        conversationType,
                        routingReason,
                        routed: true
                    }
                }
            });
        });

        // Route to appropriate specialized function based on conversation type
        if (conversationType === 'BUILD_FRAGMENT') {
            await step.run('trigger-build-fragment', async () => {
                await inngest.send({
                    name: 'ankar.ai/build-initial-fragment',
                    data: {
                        conversationId,
                        messageId,
                        message,
                        projectId,
                        orgId,
                        userId,
                        templateName: 'default'
                    }
                });
            });
        } else if (conversationType === 'UPDATE_FRAGMENT') {
            await step.run('trigger-update-fragment', async () => {
                await inngest.send({
                    name: 'ankar.ai/update-existing-fragment',
                    data: {
                        conversationId,
                        messageId,
                        message,
                        projectId,
                        orgId,
                        userId
                    }
                });
            });
        } else if (conversationType === 'FIX_ERRORS') {
            await step.run('trigger-fix-errors', async () => {
                await inngest.send({
                    name: 'ankar.ai/fix-errors-in-existing-fragment',
                    data: {
                        conversationId,
                        messageId,
                        message,
                        projectId,
                        orgId,
                        userId
                    }
                });
            });
        }
        // For GENERAL_CHAT, we're done - the response is already in the message

        return {
            conversationType,
            routingReason,
            message: routingMessage,
            routed: conversationType !== 'GENERAL_CHAT'
        };
    }
);

module.exports.functions = [
    buildInitialFragment,
    updateExistingFragment,
    fixErrorsInExistingFragment,
    processMessage,
];