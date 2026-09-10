// Deliberately exclude thinking, tool arguments/results and credentials from previews.
export function publicProgress(message) {
  const event = message?.type === 'stream_event' ? message.event : null;
  if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') return {kind:'text',text:event.delta.text};
  if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use' && typeof event.content_block.name === 'string') return {kind:'tool',name:event.content_block.name};
  return null;
}
