// TODO: Use pi-ai's Message type instead when we get to that part
export type Message = { text: string; role: string };

export type State = {
  id: string;
  userPrompt: string;
  messages: Message[];
};

export type Action =
  | { type: "updateUserPrompt"; text: string }
  | { type: "addMessage"; message: Message };
