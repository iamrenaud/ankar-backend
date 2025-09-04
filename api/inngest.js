const { createAgent, openai, createNetwork } = require('@inngest/agent-kit')
const containerApi = require('../utility/containerApi');
const inngest= require('../lib/inngest');

const sayHello = inngest.createFunction(
    { id: 'say-hello' },
    { event: 'ankar.ai/say-hello' },
    async ({event, step}) => {

        const containerName = await step.run('get-container-name', async () => {
            const response = await containerApi.post('/create-browser-container', {
                containerName: 'ankar-ai-vite-svelte',
                templateName: 'vite-svelte',
            });
            return response.data.name;
        });

        await step.run('start-container', async () => {
            const response = await containerApi.post(`/start-browser-container`, {
                containerName: 'ankar-ai-vite-svelte',
            });
        });

        const codeAgent = createAgent({
            name: "Code Agent",
            system: "You are an expert react.js developer. You write readable, maintainable code. You write simple React snippets. You use Tailwind CSS for styling.",
            model: openai({
                model: "gpt-3.5-turbo",
            }),
          });

          const { output } = await codeAgent.run(
            `Write the following snippet: ${event.data.message}`,
          );

          const containerPreviewURL = await step.run('get-container-preview-url', async () => {
            const response = await containerApi.post(`/get-browser-container-preview-url`, {
                containerName: 'ankar-ai-vite-svelte',
                port:5173,
                isExpo: false,
            });
            return response.data.previewUrl;
          });

        return {
            output,
            containerPreviewURL,
        };
    }
)


module.exports.inngest = inngest;
module.exports.functions = [
    sayHello,
];