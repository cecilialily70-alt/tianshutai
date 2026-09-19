import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ChatConfigContext = createContext({ activeChat: {} });

export function ChatConfigProvider({ children }) {
  const [activeChat, setActiveChat] = useState({});

  useEffect(() => {
    const unsub = window.shellAPI?.chatConfig?.onActiveChat?.(({ tabId, chatId, chatTitle }) => {
      setActiveChat((prev) => {
        const current = prev[tabId];
        if (current?.chatId === chatId && current?.chatTitle === chatTitle) return prev;
        return { ...prev, [tabId]: { chatId, chatTitle } };
      });
    });
    return () => {
      unsub?.();
    };
  }, []);

  const value = useMemo(() => ({ activeChat }), [activeChat]);

  return <ChatConfigContext.Provider value={value}>{children}</ChatConfigContext.Provider>;
}

export function useChatConfig() {
  return useContext(ChatConfigContext);
}
