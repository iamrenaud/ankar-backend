const { createAgent, openai, createNetwork, anthropic, createState } = require('@inngest/agent-kit')
const containerApi = require('../utility/containerApi');
const inngest= require('../lib/inngest');
const { prompt } = require('../prompt');
const aiTools = require('../utility/ai-tools');
const { lastAssistantTextMessageContent } = require('../utility/other');

const sayHello = inngest.createFunction(
    { id: 'say-hello' },
    { event: 'ankar.ai/say-hello' },
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
            containerPreviewURL: "https://7w7n9d2uo3kw.z-apps.site",
            containerName: "saas-landing-react",
        },{
            messages: previousMessages,
        });

        const codeAgent = createAgent({
            name: "code-agent",
            description: "An expert coding agent",
            system: prompt,
            model: openai({
                model: "gpt-5",
                baseUrl: "https://api.ephone.ai/v1/",
                apiKey: "sk-P9SdzvOJ17yH9KGm0ecQNioKU3bAtbA6zvYAr49wjQAl4H3d",
            }),
            tools: [
                ...aiTools,
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

        const network = createNetwork({
            name: 'coding-agent-network',
            agents: [codeAgent],
            maxIter: 25,
            defaultState: state,
            router: async ({  network }) => {
                const summary = network.state.data.summary;
                if (summary) {
                    return ;
                }
                return codeAgent;
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

module.exports.inngest = inngest;
module.exports.functions = [
    sayHello,
];