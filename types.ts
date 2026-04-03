export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
  image?: string; // Base64 data string
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}