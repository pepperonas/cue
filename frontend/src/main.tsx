import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import App from './App'
import { SettingsProvider } from './state/settings'
import { ToastProvider } from './state/toast'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h — keep for offline reads
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Persist the cache so the last data is readable offline (PWA).
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'cue-cache' })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <SettingsProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SettingsProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
)
