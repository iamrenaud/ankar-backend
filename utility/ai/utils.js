module.exports.lastAssistantTextMessageContent = (result) => {
    const assistantTextMessageIndex = result.output.findLastIndex(
        (message) => message.role === 'assistant'
    );

    const message = result.output[assistantTextMessageIndex] || undefined;
    return message?.content 
        ? typeof message.content === 'string' 
            ? message.content 
            : message.content.map(c => c.text).join('') 
        : undefined;
}