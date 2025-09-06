const { createTool } = require('@inngest/agent-kit');
const { z } = require('zod');
const containerApi = require('../containerApi');

const createAndStartContainerTool = createTool({
    name: 'createAndStartContainer',
    description: 'Create and start a container',
    parameters: z.object({
        containerName: z.string(),
        templateName: z.string(),
    }),
    handler: async ({ containerName, templateName }, { step }) => {
        const createdContainerName = await step.run('create-a-container', async () => {
            try {
                const response = await containerApi.post(`/create-browser-container`, {
                    containerName,
                    templateName,
                });

                if (response.data.message !== "BrowserContainer created successfully") {
                    throw new Error("Error: " + " Could not create container");
                }

                return response.data.containerName;
            } catch (error) {
                console.error(error);
                throw new Error("Error: " + JSON.stringify(error?.response?.data?.error || error));
            }
        });

        if (createdContainerName.includes("Error: ")) {
            throw new Error(createdContainerName);
        }

        return await step.run('start-a-container', async () => {
            try {
                const response = await containerApi.post(`/start-browser-container`, {
                    containerName,
                });

                await new Promise(resolve => setTimeout(resolve, 10000));

                if (response.data.message !== "BrowserContainer started successfully") {
                    throw new Error("Error: " + " Could not start container");
                }

                return response.data.name;
            } catch (error) {
                console.error(error);
                throw new Error("Error: " + JSON.stringify(error?.response?.data?.error || error));
            }
        });
    },
});

const getContainerPreviewURLTool = createTool({
    name: 'getContainerPreviewURL',
    description: 'Get the preview URL of a container',
    parameters: z.object({
        containerName: z.string(),
        port: z.number(),
        isExpo: z.boolean(),
    }),
    handler: async ({ containerName, port, isExpo }, { step, network }) => {

        console.log('getContainerPreviewURL', containerName, port, isExpo);

        const result = await step.run('get-container-preview-url', async () => {
            try {
                const response = await containerApi.post(`/get-browser-container-preview-url`, {
                    containerName,
                    port,
                    isExpo,
                });

                if (response.data.message !== "Preview URL retrieved successfully") {
                    throw new Error("Error: " + " Could not get preview URL");
                }

                await new Promise(resolve => setTimeout(resolve, 25000));

                return {
                    containerPreviewURL: response.data.previewUrl,
                }
            } catch (error) {
                // console.error(error);
                throw new Error("Error: " + JSON.stringify(error?.response?.data?.error || error));
            }
        });

        // Set the network state after the step completes
        if (result && result.containerPreviewURL) {
            console.log('Setting network state with containerPreviewURL:', result.containerPreviewURL);
            network.state.data.containerPreviewURL = result.containerPreviewURL;
        }

        return result;
    },
});

const terminalTool = createTool({
    name: 'terminal',
    description: 'Use the terminal to run commands',
    parameters: z.object({
        containerName: z.string(),
        command: z.string(),
    }),
    handler: async ({ containerName, command }, { step }) => {

        console.log('command', command);

        return await step.run('terminal', async () => {
            try {
                const response = await containerApi.post(`/execute-command`, {
                    containerName,
                    command: command.split(' '),
                });
    
                if (response.data.result.stderr && response.data.result.exitCode !== 0) {
                    console.error(
                        `Command failed: \n command: ${command} \n stdout: ${response.data.result.stdout} \n stderr: ${response.data.result.stderr}\n exitCode: ${response.data.result.exitCode}`
                    );
                    return `Command failed: \n command: ${command} \n stdout: ${response.data.result.stdout} \n stderr: ${response.data.result.stderr}\n exitCode: ${response.data.result.exitCode}`;
                } else {
                    return `Command successful: \n command: ${command} \n stdout: ${response.data.result.stdout} \n stderr: ${response.data.result.stderr} \n exitCode: ${response.data.result.exitCode}`;
                }
            } catch (error) {
                // console.error(error);
                throw new Error("Error: " + JSON.stringify(error?.response?.data?.error || error));
            }

        });
    },
});

const writeOrUpdateFilesWithDiffTool = createTool({
    name: 'writeOrUpdateFiles',
    description: 'Write or update files, You can write multiple files at once (recommended 2-3 files at a time)',
    parameters: z.object({
        containerName: z.string(),
        files: z.array(z.object({
            path: z.string(),
            content: z.string(),
        })),
    }),
    handler: async ({ containerName, files }, { step, network }) => {

        console.log(typeof files);
        console.log('==files==', files.map(file => Object?.keys(file)));

        const newFiles = await step?.run('write-multiple-files', async () => {
            try {
                const updatedFiles = network.state.data.files || {};
                for (const file of files) {
                    await containerApi.put(`/write-file-with-diff`, {
                        containerName,
                        path: file.path,
                        content: file.content,
                    });
                    updatedFiles[file.path] = file.content;
                }
                return updatedFiles;
            } catch (error) {
                console.error(error);
                return "Error: " + JSON.stringify(error?.response?.data?.error || error);
            }            
        });

        // if (typeof newFiles === 'object') {
        //     network.state.data.files = newFiles;
        // }
    },
});

const readFilesTool = createTool({
    name: 'readFiles',
    description: 'Read a files from the container',
    parameters: z.object({
        files: z.array(z.object({
            path: z.string(),
        })),
        containerName: z.string(),
    }),
    handler: async ({ files, containerName }, { step }) => {
        return await step?.run('read-files', async () => {
            try {
                const contents = [];
                for (const file of files) {
                    const response = await containerApi.post(`/read-file`, {
                        containerName,
                        path: file.path,
                    });
                    contents.push({ path: file.path, content: response.data.content });
                }
                return JSON.stringify(contents);
            } catch (error) {
                console.error(error);
                return "Error: " + (error?.response?.data?.error || error);
            }
        });
    },
});

const readPathTree = createTool({
    name: 'readPathTree',
    description: 'Read the path tree of the project, with depth=2',
    parameters: z.object({
        containerName: z.string(),
        path: z.string(),
    }),
    handler: async ({ containerName, path }, { step }) => {

        console.log("Read path three");
        console.log(path, containerName);

        return await step?.run('read-path-tree', async () => {
            try {
                const response = await containerApi.post(`/read-path-tree`, {
                    containerName,
                    path,
                });
                return JSON.stringify(response.data.pathTree);
            } catch (error) {
                console.error(error);
                return "Error: " + JSON.stringify(error?.response?.data?.error?.details || error);
            }
        });
    },
});

const startNpmDev = createTool({
    name: 'startNpmDev',
    description: 'Start the development server',
    parameters: z.object({
        containerName: z.string(),
        port: z.number(),
    }),
    handler: async ({ containerName, port }, { step }) => {
        return await step.run('start-npm-dev', async () => {
            try {
                const response = await containerApi.post(`/start-npm-dev`, {
                    containerName,
                    port,
                });
                return response?.data?.message;
            } catch (error) {
                console.error(error);
                throw new Error("Error: " + JSON.stringify(error?.response?.data?.error?.details || error));
            }
        });
    },
});

const restartNpmDev = createTool({
    name: 'restartNpmDev',
    description: 'Restart the development server',
    parameters: z.object({
        containerName: z.string(),
        port: z.number(),
    }),
    handler: async ({ containerName, port }, { step }) => {
        return await step.run('restart-npm-dev', async () => {
            try {
                const response = await containerApi.post(`/restart-npm-dev`, {
                    containerName,
                    port,
                });
                return response.data.message;
            } catch (error) {
                console.error(error);
                return "Error: " + JSON.stringify(error?.response?.data?.error?.details || error);
            }
        });
    },
});

const checkForErrors = createTool({
    name: 'checkForErrors',
    description: 'Check for errors in the project. MUST use this tool every time before starting the development server',
    parameters: z.object({
        containerName: z.string(),
    }),
    handler: async ({ containerName }, { step }) => {
            return await step.run('check-for-errors', async () => {
                try {
                    const response = await containerApi.post(`/check-for-errors`, {
                        containerName,
                    });
                    return response.data;
                } catch (error) {
                    console.error(error);
                    return "Error: " + JSON.stringify(error.response.data?.error || error);
                }
            });
    },
});

// Get base directives (based on the project template)
const getTemplateDirectives = createTool({});

// Get base design tool
const getBaseDesignTool = createTool({});

// Create asset image
const createAssetImage = createTool({});

// use node instead of debian + have tailwindcss pre-installed


module.exports.codeAgentTools = [
    getContainerPreviewURLTool,
    terminalTool,
    writeOrUpdateFilesWithDiffTool,
    readFilesTool,
    readPathTree,
    createAndStartContainerTool,
    startNpmDev,
    restartNpmDev,
    checkForErrors,
    getTemplateDirectives
];

module.exports.designAgentTools = [
    getBaseDesignTool,
    createAssetImage,
];

