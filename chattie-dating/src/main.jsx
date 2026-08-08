import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// // Initialize MSW before React renders
// async function enableMocking() {
//   if (process.env.NODE_ENV !== 'development') {
//     return
//   }
//   const { worker } = await import('./mocks/browser')
//   return worker.start()
// }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )