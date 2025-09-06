const { createAgent, openai } = require('@inngest/agent-kit');
const { lastAssistantTextMessageContent } = require('./utils');
const { basePrompt, designPrompt, generalPrompt } = require('./ai-prompt');
const aiTools = require('./ai-tools');


// Initial Agents
const codeAgent = createAgent({
    name: "code-agent",
    description: "An expert coding agent",
    system: basePrompt,
    model: openai({
        model: "gpt-5",
        baseUrl: "https://api.ephone.ai/v1/",
        apiKey: "sk-P9SdzvOJ17yH9KGm0ecQNioKU3bAtbA6zvYAr49wjQAl4H3d",
    }),
    tools: [
        ...aiTools.codeAgentTools,
    ],
    lifecycle:{
        onResponse:  async ({ result, network }) => {

            if (result.output?.at(0)?.type == "text" && result.output?.at(0)?.role == "assistant") {
                console.log("text", result.output?.at(0)?.content);
            }

            const lastAssistantMessageText = lastAssistantTextMessageContent(result);

            if (lastAssistantMessageText && network) {
                if (lastAssistantMessageText.includes('<task_summary>')) {
                    network.state.data.summary = lastAssistantMessageText;
                }
            }

            return result;
        }
    }
});

const designAgent = createAgent({
    name: "design-agent",
    description: "An expert design agent with an eye for detail",
    system: designPrompt,
    model: openai({
        model: "gpt-5",
        baseUrl: "https://api.ephone.ai/v1/",
        apiKey: "sk-P9SdzvOJ17yH9KGm0ecQNioKU3bAtbA6zvYAr49wjQAl4H3d",
    }),
    tools: [
        ...aiTools.designAgentTools,
    ],
    lifecycle:{
        onResponse:  async ({ result, network }) => {
            return result;
        }
    }
});

// Continuity Agents (for changes on the initial result)


// Fixing Agents (for fixing errors)



// General Agent (for routing and general conversation)
const generalAgent = createAgent({
    name: "general-agent",
    description: "An intelligent routing agent that determines conversation type and provides guidance",
    system: generalPrompt,
    model: openai({
        model: "gpt-5",
        baseUrl: "https://api.ephone.ai/v1/",
        apiKey: "sk-P9SdzvOJ17yH9KGm0ecQNioKU3bAtbA6zvYAr49wjQAl4H3d",
    }),
    lifecycle: {
        onResponse: async ({ result, network }) => {
            if (result.output?.at(0)?.type == "text" && result.output?.at(0)?.role == "assistant") {
                console.log("General agent response:", result.output?.at(0)?.content);
                
                const response = result.output?.at(0)?.content;
                
                // Parse the response to extract conversation type
                const conversationTypeMatch = response.match(/<conversation_type>(.*?)<\/conversation_type>/);
                const routingReasonMatch = response.match(/<routing_reason>(.*?)<\/routing_reason>/);
                const messageMatch = response.match(/<message>(.*?)<\/message>/s);
                
                if (conversationTypeMatch && routingReasonMatch && messageMatch) {
                    const conversationType = conversationTypeMatch[1].trim();
                    const routingReason = routingReasonMatch[1].trim();
                    const message = messageMatch[1].trim();
                    
                    // Store routing information in network state
                    network.state.data.conversationType = conversationType;
                    network.state.data.routingReason = routingReason;
                    network.state.data.routingMessage = message;
                    
                    console.log(`Routing to: ${conversationType} - ${routingReason}`);
                }
            }
            
            return result;
        }
    }
});


module.exports.agents = [
    codeAgent,
    designAgent,
    generalAgent,
];