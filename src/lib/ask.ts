// Open the Ask chat from anywhere on the page, with a first message already sent.
export const ASK_EVENT = 'cotreasury:ask'

export function openAsk(prompt: string) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { prompt } }))
}
